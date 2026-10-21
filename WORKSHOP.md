# Facilitator script

How to run the hands-on part of the Design & Verify workshop with Certificate Lab. About **25 minutes**.

## Before the workshop

- [ ] Push this repo to GitHub and put the link on a slide (or a QR code).
- [ ] On **your** laptop: start it (`docker compose up -d --build` or `npm start`) and open the ops dashboard on the projector: http://localhost:3000/dashboard
- [ ] Run `k6 run k6/smoke.js` once to make sure everything is green.
- [ ] Click **quiet tuesday** and **Reset the charts** so you start clean.
- [ ] Tell people the day before to install Docker Desktop, or Node.js + k6 (see the README), or to have a GitHub account for Codespaces.
- [ ] Optional: start with `ADMIN_KEY=something` if attendees will open your dashboard, so nobody flips your knobs mid-demo.

## Part 1: be a student (3 min)

- Open http://localhost:3000. Log in as `S10000`.
- Click **My documents**, then **Get certificate**, then **Download PDF**.
- Point at the badge: *"3 clicks. That's our CTQ. And the PDF took 0.2 seconds, under the 3 second CTQ."*
- Log in as `S10009`: no button. *"Poka-yoke: you can't ask for something you're not eligible for."*
- Click **Check it like an employer would**. *"That's the verification code CTQ."*

## Part 2: verification, with a smoke test (4 min)

Run:

```bash
k6 run k6/smoke.js
```

Read out a few green checks. *"Every one of these lines is a CTQ turned into a test. This is verification: did we build it right?"*

Now, on the dashboard, tick **Break access control**. Run the smoke test again.

*"One red line: you can open someone else's certificate. That's number 1 on the OWASP Top 10, and our test caught it before any student did."*

Untick it.

## Part 3: 500 students (8 min)

On the dashboard, click **quiet tuesday** and **Reset the charts**. Run:

```bash
k6 run k6/load.js
```

While it runs (35 s), talk over the dashboard:
- requests per second climbs as the 500 students arrive
- both CTQ boxes stay green

Then click **registration week**, reset the charts, run it again.
- the "students waiting in line" tile grows
- the PDF time line crosses the dashed 3 s line
- both CTQ boxes go red, and k6 ends with ✗ and an error

Ask the room: **"What would you change in the design?"** Take 2 or 3 answers (more servers, a queue, faster PDFs, caching…).

Click **registration week + design moves** and run it once more. Green again.

*"Same rush, same slow PDF generator. Two design moves: more workers, and when we're busy we say 'we'll email it' instead of an error. Look at the end of the k6 output: about 550 students got an email promise instead of a failure."*

## Part 4: their turn (10 min)

Everyone opens their own copy (Docker, laptop or Codespaces) and does at least two of these:

1. Run `smoke.js`, then tick a bug on **their** dashboard and see which check catches it.
2. On **registration week**, find the smallest number of PDF workers that makes `load.js` pass.
3. Make the CTQ stricter in `k6/load.js` (`p(95)<1000`) and see if the design still holds.
4. Run `spike.js` (1000 students in 5 s). Which scenario survives it?

Ask 2 people to share what they found.

**The twist to end on:** on **design moves**, `spike.js` passes both thresholds, but look at `emailed_instead_of_error` in the k6 output: thousands of "we'll email it" promises. *"k6 says pass. Would a student who needed the PDF right now say pass? That's the gap between verification and validation."*

## Talking points to tie it back to the slides

- **Design**: the knobs are design decisions. "Queue it and email it" is the reliability design move from the reliability slide.
- **Verification vs validation**: k6 checks the spec (verification). It can't tell you whether employers accept a PDF. That still needs real people (validation).
- **Measurable requirements**: k6 thresholds *are* the CTQs. A requirement without a number can't become a threshold.
- **Noise**: registration week is the noise box from the P-diagram, made real.

## If something goes wrong

- Dashboard shows "server unreachable": the service stopped. Run `npm start` / `docker compose up -d` again.
- Everything is slow even on quiet tuesday: your laptop is busy (screen recording, 40 browser tabs). Use `k6 run -e STUDENTS=200 k6/load.js`.
- Wi-Fi is bad: everything runs on localhost, the internet is only needed to install things.
