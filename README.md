# Clair Lut — Pferdegalerie

Eine einfache, deutschsprachige Webseite zum Vorstellen deiner Pferdegemälde. Reines HTML/CSS/JS — läuft direkt auf GitHub Pages, kein Server nötig.

**Alle Dateien liegen absichtlich in einem einzigen Ordner, ohne Unterordner** (kein `css/`, `js/`, `images/` mehr) — das ist wichtig, siehe unten.

## Warum die erste Version nicht lud

Beim Hochladen sind `css/styles.css`, `js/script.js` und alle Bilder aus den Unterordnern in deinem GitHub-Repo als einzelne Dateien im Hauptverzeichnis gelandet (ohne die Ordner `css/`, `js/`, `images/`) — vermutlich weil GitHubs einfacher Datei-Upload Unterordner nicht automatisch anlegt, wenn man mehrere Dateien auf einmal hochlädt. Die `index.html` hat aber weiterhin nach `css/styles.css` & Co. gesucht, die es an der Stelle nicht mehr gab → Seite ohne Formatierung und ohne Bilder.

**Die Lösung**: Diese Version hat gar keine Unterordner mehr — alles liegt direkt nebeneinander. So kann beim Hochladen nichts mehr verrutschen.

## So bringst du sie auf GitHub Pages

1. Falls du es neu machst: Erstelle auf github.com ein neues Repository (oder nutze dein bestehendes `WPM`-Repository).
2. **Wichtig, falls du dein bestehendes Repository weiterverwendest**: Lösche zuerst alle alten Dateien darin (die alte `index.html`, `styles.css`, `script.js`, alle Bilder), damit nichts Verwaisetes übrig bleibt.
3. Lade **alle Dateien aus diesem Ordner** direkt in das Hauptverzeichnis des Repositorys hoch (per Drag & Drop auf github.com über „Add file → Upload files“, oder per `git push`). Keine Unterordner anlegen — alles kommt auf dieselbe Ebene wie `index.html`.
4. Gehe im Repo zu **Settings → Pages**.
5. Unter „Build and deployment“ steht **Source: Deploy from a branch**, Branch: `main`, Ordner: `/ (root)`. Falls nicht, so einstellen und speichern.
6. Nach 1–2 Minuten ist die Seite live unter `https://<dein-github-name>.github.io/<repo-name>/`.

## Was du noch anpassen solltest

- **Titel, Technik, Maße, Preise**: Jedes Werk steht in `index.html` als eigener `<article class="artwork">`-Block. Aktuell steht bei allen vieren „Original · Technik & Maße auf Anfrage“ und „Preis auf Anfrage“ als Platzhalter — trag dort die echten Angaben ein, sobald du sie hast (und ändere den Status zu „Verkauft“, sobald ein Bild verkauft ist — die Klasse dafür heißt `status-sold` statt `status-available`).
- **Weitere Gemälde hinzufügen**: Einfach einen kompletten `<article class="artwork">`-Block (innerhalb eines `<div class="gallery-col">`) kopieren, Bild/Text anpassen und die neue Bilddatei direkt mit in den Hauptordner hochladen (kein Unterordner!).
- **Bilder austauschen**: Lade die neue Datei einfach mit in den Hauptordner hoch und passe den `src="..."`-Dateinamen an der passenden Stelle in `index.html` an. Achte auf ein ähnliches Seitenverhältnis wie das bisherige Bild, sonst wird es unschön zugeschnitten — das lässt sich über `style="--ratio: Breite / Höhe;"` am `<div class="artwork-image">` einstellen.
- **Kontakt**: Die E-Mail-Adresse ist aktuell `claraluety@googlemail.com` (im `mailto:`-Link und im Fließtext in `index.html`) — dort ändern, falls du eine andere Adresse nutzen möchtest.
- **Vor Ort**: Café Bodien, Bergsdorf steht im Abschnitt „Vor Ort“ — dort auch Öffnungszeiten oder eine genaue Adresse ergänzen, falls gewünscht.
- **Signatur/Name**: Aktuell erscheint überall „Clair Lut“ als Künstlername (im Logo oben und in der „clair lut“-Sektion).

## Struktur

```
index.html          ← der gesamte Seiteninhalt
styles.css          ← Layout & Farben
script.js           ← nur die Jahreszahl im Footer
favicon.svg          ← kleines Icon im Browser-Tab
herbst.jpg, am-wasser.jpg, uebermut.jpg, blick.jpg   ← die vier Gemälde
herbst-detail.jpg, uebermut-detail.jpg               ← zwei Nahaufnahmen als Deko-Akzente
```

Kein Build-Prozess, keine Abhängigkeiten, keine Unterordner — einfach Dateien bearbeiten und alle zusammen neu hochladen.
