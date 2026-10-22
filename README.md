# Projektapp

Streamlit-app för en tekniker som kör fiber- och CAT6-jobb. Skapa projekt, bocka av steg, skriv kommentarer, ta foton i telefonen och exportera allt till Excel.

## Starta lokalt

```powershell
cd C:\Users\ewill\projects-app
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .streamlit\secrets.toml.example .streamlit\secrets.toml
```

Fyll i Google Client ID och Client Secret i `.streamlit/secrets.toml`. I Google Cloud Console, lägg till:

- Authorized JavaScript origin: `http://localhost:8501`
- Authorized redirect URI: `http://localhost:8501/oauth2callback`

Sedan:

```powershell
streamlit run app.py
```

## Telefon

Streamlit funkar i telefonens webbläsare. För att logga in utifrån hemmanätet behöver appen en publik URL (till exempel Streamlit Community Cloud). Lägg då även in den publika adressen som origin och `/oauth2callback` som redirect URI.

Foton kan tas direkt med kameran i appen. De sparas lokalt i `data/uploads`. Dropbox kan kopplas på senare om du vill ha molnsynk.

## Excel

Under **Export** kan du ladda ner antingen flera flikar (Projekt, Steg, Kommentarer, Foton, Lägenheter) eller allt i en flik.
