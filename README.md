# Grace BJJ Kids

A welcome page for families, a coloring-sheet page, and a staff planner for class. The staff planner is the Grace BJJ Kids program: 45-minute classes, 5:30–6:15 PM PT, on the 2nd and 4th Tuesday of each month. The first class is Tuesday, October 27, 2026.

## Pages

| Address | Who can open it |
| --- | --- |
| `/` | Anyone. Welcome, values, class time, age groups, what to bring. |
| `/coloring/` | Anyone. Print a coloring sheet with a child's name. |
| `/login/` | Teachers and admins. |
| `/app/` | Teachers and admins, after login. |

The live site is served from the Debian host described in [DEPLOY.md](DEPLOY.md). Opening the files on disk still shows the splash and the coloring page. The planner and the camera need the attendance server, because those pages ask `/api/bootstrap` before they draw.

## Welcome page

The splash shows the Grace Jiu Jitsu logo, the values Competence, Connection, and Community, the class schedule, the next class date, the two age groups, and what to bring the first week. A large button goes to the coloring sheets. Teacher login is a small link.

The welcome page shows the church address and an email for questions. Phone and a sign-up link are not on the page yet. Add those in the `PUBLIC_INFO` object in `index.html`. A value left as `""` stays hidden.

## Coloring sheets

Parents pick a built-in sheet, type a child's name, optionally pick a belt color to color in, and add a move of the week. Print or save a PDF from the browser. If a teacher sets “this week's sheet” in the staff app, the coloring page shows that caption. The public API returns only a sheet id and a caption, plus sheets an admin has published. It does not return student names, attendance, or notes.

## Staff app

Log in at `/login/`, then the planner opens at `/app/`.

### Age groups

- **3–6 Mighty Mites** — positions and movement. Kids this age must be fully potty trained. Sparring starts off for this group, and a kid still needs at least one stripe plus enough adults before it is turned on.
- **7–10 Pee Wees** — partner drills, escapes, sweeps, passes, and a slow americana and armbar from mount. Warm-up counts stay as written.

**Load first class plan** is the toddler intro (ages 3–5). It stays as a preset.

### Class shape

Every class opens with a short prayer, then line up by rank and bow in, warm up, base (forward roll, backward roll, hip escape), one technique theme, a water break, then sparring or positional drilling, then a game, then bow out. The prayer is the first 2 minutes: thanks, good use of the gift, and prayer for someone who needs it. A fresh plan uses a 3 minute warm-up so class still runs 5:30–6:15. The technique block is the long one. Steps, the partner drill, the prayer, and any safety note print on the plan.

The lesson keeps its minutes first. The opening prayer stays at 2 minutes. If the clock is tight, warm-up and base shrink before the lesson does. The closing game can shrink to about 3 minutes and stays on the plan when you asked for a game. Extra minutes go to the lesson.

Auto theme picks the position that has gone the longest without being taught. You can lock a theme. Live sparring is for any age group, including 3–6, when a student has at least one stripe and enough adults are supervising for the 4:1 ratio. A 3–6 plan starts with sparring off. Otherwise that block is positional drilling.

### Roster, progress, and attendance

The roster, belts, stripes, class log, technique levels, and notes are stored on the server and shared by every logged-in teacher. An admin adds and edits students and logins. A teacher can take attendance, set levels, and write notes.

**Review** is for right after class. Tap who was here, tap a level (Introduced, Practicing, Can do it with help, Can do it on their own), and save. Saving marks that class taught. Kids who were there, and who did not already have a level, are marked Introduced.

**Progress** shows coverage for the age group on screen, each kid's attendance, and a stripe hint. The teacher still decides when a stripe goes on the belt.

**Check-in** scans a student card for the date you pick.

- **Full-page cards** — one student per page, with the logo, name, age group, belt, stripes, and a QR code.
- **Wallet cards** — several cards per page.
- **Sign-in sheet** — one class date, every name, a small QR code, and a checkbox.

The code is `GBJJ1`, the student's id, and a short checksum. A second scan does not add them twice. The camera uses `getUserMedia` and needs `https://` or `localhost`. Photo upload still decodes cards when the camera is unavailable.

Plans, custom drills, and rep counts stay in this browser. Use **Export library** to move that planner data to another computer. Use **Download attendance backup** (admin) for the roster and class log. A browser that still has a roster from before the server shows a one-time import button.

## Libraries in this repo

QR codes are generated and read offline. Nothing is loaded from a CDN when the page runs.

- `vendor/qrcode-generator/` — [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 by Kazuhiko Arase, MIT. See `vendor/qrcode-generator/LICENSE`.
- `vendor/jsQR/` — [jsQR](https://github.com/cozmo/jsQR) 1.4.0 by Cosmo Wolfe, Apache-2.0. See `vendor/jsQR/LICENSE`.

You can still add your own warm-ups, base drills, techniques, and games in the library. A technique can carry a theme, a position, up to four coaching steps, a partner drill, and a safety note.
