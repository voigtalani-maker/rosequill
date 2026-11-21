# Rosequill

A pink fantasy writing studio that works in the browser and installs as an app.

- **Writing studio:** a binder, corkboard, outline, snapshots, word goals, focus mode, and compile to Word, PDF, HTML, Markdown or plain text.
- **Linked notes:** `[[wikilinks]]` with suggestions, backlinks, unlinked mentions, `#tags`, a constellation graph, and a quick switcher (Ctrl+K).
- **Word Oracle:** synonyms, opposites, meanings, rhymes, describing words, related words, sound-alikes, and translations.

Live at https://voigtalani-maker.github.io/rosequill/

Everything you write saves as you type in your own browser (IndexedDB). The ☁ **Backups** button adds two optional extra copies:

- **A folder** you choose (Chrome or Edge on a computer). It gets a full backup, a **Word document** (`.docx`) of each grimoire, 14 daily copies and every page as a `.md` file. Choose a folder in Google Drive (via Google Drive for desktop) and the Word document opens in Google Docs. OneDrive works too.
- Any cloud backup or daily version can also be downloaded as a Word document, and **Compile → Word** makes a real `.docx`.
- A **guided tour** runs the first time Rosequill opens; replay it from **▾ → Take the tour**.
- **Maps:** generate a detailed fantasy map (coasts, mountains, forests, rivers, named towns and regions) and reshape it with brushes, places, roads, borders and labels. Places can link to Lore pages, and a map saves as a picture.
- **Focus timer:** a small ⏱ in the top bar for writing sprints.
- **A private cloud backup** in Supabase, under a Rosequill account you make once (just a username and a password). It keeps 30 days of daily versions and syncs to your other devices. Row-level security means only you can read your rows.

Word lookups use the free [Datamuse](https://www.datamuse.com/api/), [Free Dictionary](https://dictionaryapi.dev/) and [MyMemory](https://mymemory.translated.net/) services. Only the word you look up is sent to them.
