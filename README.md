# Rosequill

A pink fantasy writing studio that works in the browser and installs as an app.

- **Writing studio:** a binder, corkboard, outline, snapshots, word goals, focus mode, and compile to Word, PDF, HTML, Markdown or plain text.
- **Linked notes:** `[[wikilinks]]` with suggestions, backlinks, unlinked mentions, `#tags`, a constellation graph, and a quick switcher (Ctrl+K).
- **Word Oracle:** synonyms, opposites, meanings, rhymes, describing words, related words, sound-alikes, and translations.

Live at https://voigtalani-maker.github.io/rosequill/

Everything you write saves as you type in your own browser (IndexedDB). The ☁ **Backups** button adds two optional extra copies:

- **A folder** you choose (Chrome or Edge on a computer). It gets a full backup, 14 daily copies and every page as a `.md` file. Choose a OneDrive folder and OneDrive backs it up too.
- **A private cloud backup** in Supabase, signed in with your Study Hub account. It keeps 30 days of daily versions and syncs to your other devices. Row-level security means only you can read your rows.

Word lookups use the free [Datamuse](https://www.datamuse.com/api/), [Free Dictionary](https://dictionaryapi.dev/) and [MyMemory](https://mymemory.translated.net/) services. Only the word you look up is sent to them.
