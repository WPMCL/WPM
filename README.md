# Clair Lut — Pferdegalerie

Eine einfache, deutschsprachige Webseite zum Vorstellen deiner Pferdegemälde. Reines HTML/CSS/JS — läuft direkt auf GitHub Pages, kein Server nötig.

## So bringst du sie auf GitHub Pages

1. Erstelle auf github.com ein neues Repository, z. B. `clair-lut-pferdegalerie`.
2. Lade **alle Dateien aus diesem Ordner** (`index.html`, `css/`, `js/`, `images/`) in das Repository hoch (per Web-Upload oder `git push`).
3. Gehe im Repo zu **Settings → Pages**.
4. Unter „Build and deployment“ wähle **Source: Deploy from a branch**, Branch: `main`, Ordner: `/ (root)`. Speichern.
5. Nach 1–2 Minuten ist die Seite live unter `https://<dein-github-name>.github.io/<repo-name>/`.

## Was du noch anpassen solltest

- **Titel, Technik, Maße, Preise**: Jedes Werk steht in `index.html` als eigener `<article class="artwork">`-Block. Aktuell steht bei allen vieren „Original · Technik & Maße auf Anfrage“ und „Preis auf Anfrage“ als Platzhalter — trag dort die echten Angaben ein, sobald du sie hast (und ändere den Status zu „Verkauft“, sobald ein Bild verkauft ist — die Klasse dafür heißt `status-sold` statt `status-available`).
- **Weitere Gemälde hinzufügen**: Einfach einen kompletten `<article class="artwork">`-Block (innerhalb eines `<div class="gallery-col">`) kopieren und Bild/Text anpassen.
- **Bilder austauschen**: Lade eine neue Datei in `images/` hoch und passe den `src="images/..."`-Pfad an der passenden Stelle in `index.html` an. Achte auf ein ähnliches Seitenverhältnis wie das bisherige Bild, sonst wird es unschön zugeschnitten — das lässt sich über `style="--ratio: Breite / Höhe;"` am `<div class="artwork-image">` einstellen.
- **Kontakt**: Die E-Mail-Adresse ist aktuell `claraluety@googlemail.com` (im `mailto:`-Link und im Fließtext in `index.html`) — dort ändern, falls du eine andere Adresse nutzen möchtest.
- **Vor Ort**: Café Bodien, Bergsdorf steht im Abschnitt „Vor Ort“ — dort auch Öffnungszeiten oder eine genaue Adresse ergänzen, falls gewünscht.
- **Signatur/Name**: Aktuell erscheint überall „Clair Lut“ als Künstlername (im Logo oben und in der „clair lut“-Sektion).

## Struktur

```
index.html        ← der gesamte Seiteninhalt
css/styles.css     ← Layout & Farben
js/script.js       ← nur die Jahreszahl im Footer
images/            ← deine Bilder (Gemälde-Fotos + zwei Nahaufnahmen als Deko-Akzente)
```

Kein Build-Prozess, keine Abhängigkeiten — einfach Dateien bearbeiten und neu hochladen.
