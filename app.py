from __future__ import annotations

from collections import defaultdict

import streamlit as st

from src.auth import require_login
from src.db import (
    add_apartment,
    add_comment,
    add_photo,
    add_step,
    create_project,
    delete_project,
    get_project,
    init_db,
    list_apartments,
    list_comments,
    list_photos,
    list_projects,
    list_steps,
    set_apartment,
    set_step_done,
    update_project,
)
from src.excel_export import build_workbook
from src.photos import photo_path, remove_photo, save_upload
from src.templates import PROJECT_TYPES, STATUSES, steps_for_type

st.set_page_config(page_title="Projektapp", page_icon="📡", layout="wide")
init_db()
require_login()


def _progress_label(done: int, total: int) -> str:
    if total == 0:
        return "0 steg"
    return f"{done}/{total} · {int(done / total * 100)}%"


def page_overview() -> None:
    st.title("Projekt")
    projects = list_projects()
    if not projects:
        st.info("Inga projekt ännu. Skapa ett under Nytt projekt.")
        return

    for project in projects:
        done = int(project["done_steps"] or 0)
        total = int(project["total_steps"] or 0)
        col_main, col_open = st.columns([4, 1])
        with col_main:
            st.subheader(project["name"])
            meta = " · ".join(
                part
                for part in [
                    PROJECT_TYPES.get(project["project_type"], project["project_type"]),
                    project["address"],
                    project["status"],
                    _progress_label(done, total),
                ]
                if part
            )
            st.caption(meta)
            if total:
                st.progress(done / total)
        with col_open:
            if st.button("Öppna", key=f"open-{project['id']}", type="primary"):
                st.session_state.current_project_id = project["id"]
                st.session_state.nav = "Projekt"
                st.rerun()
        st.divider()


def page_new_project() -> None:
    st.title("Nytt projekt")
    with st.form("new-project"):
        name = st.text_input("Projektnamn", placeholder="Brf Granen / CAT6 trapphus 2")
        project_type = st.selectbox(
            "Typ",
            options=list(PROJECT_TYPES.keys()),
            format_func=lambda key: PROJECT_TYPES[key],
        )
        address = st.text_input("Adress")
        customer = st.text_input("Kund / beställare")
        notes = st.text_area("Anteckningar")
        submitted = st.form_submit_button("Skapa projekt", type="primary")

    if submitted:
        if not name.strip():
            st.error("Ange ett projektnamn.")
            return
        project_id = create_project(
            name=name,
            project_type=project_type,
            address=address,
            customer=customer,
            notes=notes,
            steps=steps_for_type(project_type),
        )
        st.session_state.current_project_id = project_id
        st.session_state.nav = "Projekt"
        st.success("Projekt skapat.")
        st.rerun()


def _grouped_steps(steps):
    grouped: dict[str, dict[str | None, list]] = defaultdict(lambda: defaultdict(list))
    for step in steps:
        grouped[step["category"]][step["subcategory"]].append(step)
    return grouped


def _render_step(project_id: int, step) -> None:
    checked = st.checkbox(
        step["title"],
        value=bool(step["done"]),
        key=f"done-{step['id']}",
    )
    if checked != bool(step["done"]):
        set_step_done(step["id"], checked)
        st.rerun()

    comments = list_comments(step["id"])
    photos = list_photos(step["id"])
    with st.expander(f"Kommentarer och foton ({len(comments)} / {len(photos)})"):
        comment_text = st.text_area(
            "Ny kommentar",
            key=f"comment-{step['id']}",
            placeholder="Skriv en notering till det här steget…",
            height=80,
        )
        if st.button("Spara kommentar", key=f"save-comment-{step['id']}"):
            add_comment(step["id"], comment_text)
            st.rerun()
        for comment in comments:
            st.markdown(f"- {comment['body']}")
            st.caption(comment["created_at"])

        if st.button("Öppna kamera", key=f"open-cam-{step['id']}"):
            st.session_state.active_camera_step = step["id"]
        camera = None
        if st.session_state.get("active_camera_step") == step["id"]:
            camera = st.camera_input("Ta foto", key=f"cam-{step['id']}")
        upload = st.file_uploader(
            "Ladda upp foto",
            type=["jpg", "jpeg", "png", "webp", "gif"],
            accept_multiple_files=True,
            key=f"up-{step['id']}",
        )
        new_files = []
        if camera is not None:
            new_files.append(camera)
        if upload:
            new_files.extend(upload)
        seen_key = f"seen-files-{step['id']}"
        seen = st.session_state.setdefault(seen_key, [])
        added = False
        for file in new_files:
            file_id = getattr(file, "file_id", None) or f"{file.name}-{len(file.getvalue())}"
            if file_id in seen:
                continue
            stored = save_upload(project_id, step["id"], file.name, file.getvalue())
            add_photo(step["id"], stored, file.name)
            seen.append(file_id)
            added = True
        if added:
            st.rerun()

        cols = st.columns(2)
        for index, photo in enumerate(photos):
            path = photo_path(photo["stored_name"])
            with cols[index % 2]:
                if path.exists():
                    st.image(str(path), caption=photo["original_name"], use_container_width=True)
                else:
                    st.warning(f"Saknas: {photo['original_name']}")
                if st.button("Ta bort foto", key=f"del-photo-{photo['id']}"):
                    remove_photo(photo["id"])
                    st.rerun()


def page_project() -> None:
    projects = list_projects()
    if not projects:
        st.info("Skapa ett projekt först.")
        return

    ids = [project["id"] for project in projects]
    default_id = st.session_state.get("current_project_id", ids[0])
    if default_id not in ids:
        default_id = ids[0]

    selected_id = st.selectbox(
        "Välj projekt",
        options=ids,
        index=ids.index(default_id),
        format_func=lambda pid: next(p["name"] for p in projects if p["id"] == pid),
    )
    st.session_state.current_project_id = selected_id
    project = get_project(selected_id)
    if project is None:
        st.error("Projektet finns inte.")
        return

    steps = list_steps(selected_id)
    done = sum(1 for step in steps if step["done"])
    total = len(steps)

    st.title(project["name"])
    st.caption(
        " · ".join(
            part
            for part in [
                PROJECT_TYPES.get(project["project_type"], project["project_type"]),
                project["address"],
                project["customer"],
            ]
            if part
        )
    )
    if total:
        st.progress(done / total, text=_progress_label(done, total))

    with st.expander("Projektuppgifter", expanded=False):
        name = st.text_input("Namn", value=project["name"], key=f"pname-{selected_id}")
        address = st.text_input("Adress", value=project["address"], key=f"paddr-{selected_id}")
        customer = st.text_input("Kund", value=project["customer"], key=f"pcust-{selected_id}")
        status = st.selectbox(
            "Status",
            STATUSES,
            index=STATUSES.index(project["status"]) if project["status"] in STATUSES else 0,
            key=f"pstat-{selected_id}",
        )
        notes = st.text_area("Anteckningar", value=project["notes"], key=f"pnotes-{selected_id}")
        save_col, delete_col = st.columns(2)
        with save_col:
            if st.button("Spara uppgifter", type="primary"):
                update_project(
                    selected_id,
                    name=name,
                    address=address,
                    customer=customer,
                    status=status,
                    notes=notes,
                )
                st.rerun()
        with delete_col:
            if st.button("Radera projekt"):
                st.session_state.confirm_delete = selected_id
        if st.session_state.get("confirm_delete") == selected_id:
            st.warning("Detta tar bort checklista, kommentarer och foton för projektet.")
            if st.button("Ja, radera"):
                delete_project(selected_id)
                st.session_state.current_project_id = None
                st.session_state.confirm_delete = None
                st.session_state.nav = "Översikt"
                st.rerun()

    grouped = _grouped_steps(steps)
    for category, subcats in grouped.items():
        st.header(category)
        for subcategory, cat_steps in subcats.items():
            if subcategory:
                st.subheader(subcategory)
            for step in cat_steps:
                _render_step(selected_id, step)

    st.subheader("Lägg till steg")
    with st.form(f"add-step-{selected_id}"):
        category = st.text_input("Kategori", placeholder="NOD, Kanalisation, CAT6…")
        subcategory = st.text_input("Underkategori (valfritt)", placeholder="Stativ, ODF, Signal…")
        title = st.text_input("Steg")
        if st.form_submit_button("Lägg till") and title.strip() and category.strip():
            add_step(selected_id, category, subcategory or None, title)
            st.rerun()

    if project["project_type"] == "fiber_apartment":
        st.header("Lägenheter")
        with st.form(f"add-apt-{selected_id}"):
            unit = st.text_input("Lägenhetsnummer")
            if st.form_submit_button("Lägg till lägenhet") and unit.strip():
                add_apartment(selected_id, unit)
                st.rerun()
        for apartment in list_apartments(selected_id):
            done_apt = st.checkbox(
                f"Lgh {apartment['unit_number']}",
                value=bool(apartment["done"]),
                key=f"apt-done-{apartment['id']}",
            )
            apt_notes = st.text_input(
                "Notering",
                value=apartment["notes"],
                key=f"apt-notes-{apartment['id']}",
            )
            if done_apt != bool(apartment["done"]) or apt_notes != apartment["notes"]:
                set_apartment(apartment["id"], done_apt, apt_notes)
                st.rerun()


def page_export() -> None:
    st.title("Excel-export")
    st.write("Exportera alla projekt, steg, kommentarer, foton (filsökvägar) och lägenheter.")
    multi = build_workbook(combined=False)
    single = build_workbook(combined=True)
    st.download_button(
        "Ladda ner flera flikar",
        data=multi,
        file_name="projekt-export.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        type="primary",
    )
    st.download_button(
        "Ladda ner en flik",
        data=single,
        file_name="projekt-export-allt.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    st.caption("Foton ligger i mappen data/uploads. Excel innehåller sökvägar, inte bildfilerna.")


def main() -> None:
    email = getattr(st.user, "email", "") or "inloggad"
    st.sidebar.title("Projektapp")
    st.sidebar.caption(email)
    if "nav" not in st.session_state:
        st.session_state.nav = "Översikt"
    nav = st.sidebar.radio(
        "Meny",
        ["Översikt", "Nytt projekt", "Projekt", "Export"],
        key="nav",
    )
    st.sidebar.button("Logga ut", on_click=st.logout)

    if nav == "Översikt":
        page_overview()
    elif nav == "Nytt projekt":
        page_new_project()
    elif nav == "Projekt":
        page_project()
    else:
        page_export()


main()
