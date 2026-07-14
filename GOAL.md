# Hiring Task — Dual Camera + GPS Data Collection App

## Context

We are building a mobile data collection platform for mobility and automotive research. The platform records synchronized sensor data during real-world driving sessions and exports it in a structured format for downstream analysis.

This task asks you to build a focused prototype of one core subsystem: **simultaneous dual-camera recording with synchronized GPS logging**, including GPS gap interpolation.

---

## Task

Build a mobile app (iOS preferred) that:

1. Records front and back cameras simultaneously to separate video files
2. Logs GPS data continuously with quality flags
3. Interpolates GPS gaps so the output has no large holes
4. Saves all output into a single organized session folder

The app should have a minimal UI — a record button and basic camera previews. The quality of the data pipeline is what we are evaluating, not the visual design.

---

## Requirements

### 1. Dual Camera Recording

- Record front and back cameras **simultaneously** to two separate video files
- Use the highest available video quality / codec (HEVC preferred on iOS)
- Both cameras must be active at the same time, not switched between
- Display a live preview of both cameras on screen during recording
- Output files:
  - `{sessionTimestamp}_FrontVideo.mov`
  - `{sessionTimestamp}_BackVideo.mov`

### 2. Frame Logging

Every video frame from both cameras must be logged to a CSV file.

**File:** `{sessionTimestamp}_FrameData.csv`

| Column      | Description                                |
| ----------- | ------------------------------------------ |
| `Timestamp` | Unix milliseconds at time of frame capture |
| `Source`    | `Front` or `Back`                          |

The timestamp must come from the actual hardware capture time, not `Date()` called after the fact.

### 3. GPS Logging

Collect GPS at the **highest available precision** (every available update).

**File:** `{sessionTimestamp}_LocationData.csv`

| Column                 | Description                                              |
| ---------------------- | -------------------------------------------------------- |
| `Timestamp_unix_ms`    | Unix milliseconds from the GPS hardware timestamp        |
| `Lat`                  | Latitude (decimal degrees)                               |
| `Long`                 | Longitude (decimal degrees)                              |
| `Speed_m_s`            | Speed in metres per second (`-1` if unavailable)         |
| `Course_deg`           | Heading in degrees (`-1` if unavailable)                 |
| `CourseAccuracy_deg`   | Course accuracy (`-1` if unavailable)                    |
| `HorizontalAccuracy_m` | Horizontal accuracy in metres                            |
| `VerticalAccuracy_m`   | Vertical accuracy in metres                              |
| `is_interpolated`      | `0` = real GPS point, `1` = synthetic interpolated point |
| `quality_flag`         | See below                                                |

**Quality flags:**

| Flag           | Meaning                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| `OK`           | Real GPS point, horizontal accuracy ≤ 20 m                                 |
| `LOW_ACCURACY` | Real GPS point, horizontal accuracy > 20 m                                 |
| `ERROR`        | GPS hardware failure — write a sentinel row with all numeric fields = `-1` |
| `INTERP`       | Synthetically interpolated point (see below)                               |

**Error rows:** When the GPS system reports an error, still write a row to the CSV with all numeric fields set to `-1`, `is_interpolated = 0`, and `quality_flag = ERROR`. Never leave a gap in the file.

### 4. GPS Interpolation

The GPS hardware delivers updates infrequently and unevenly. Your app must detect large gaps and fill them with interpolated points so the output stream is continuous.

## 5. Timestamp Synchronization

Both `FrameData.csv` and `LocationData.csv` use **Unix milliseconds** as their timestamp. This shared epoch is what ties camera frames to GPS readings in post-processing — no explicit join key is needed beyond the timestamp column. Ensure:

- GPS rows use the **hardware timestamp** from the location update (not `Date()` at time of writing)
- Frame rows use the **sample buffer presentation timestamp** converted to Unix ms

### 6. Session Folder and Metadata

All output for one recording session must live in a single folder:

```
{epochMs}_Session/
├── {epochMs}_FrontVideo.mov
├── {epochMs}_BackVideo.mov
├── {epochMs}_FrameData.csv
├── {epochMs}_LocationData.csv
└── metadata.json
```

`{epochMs}` is the Unix millisecond timestamp at the moment recording started. This makes folders sortable and unique.

### 7. UI

Keep the UI minimal:

- Live preview of front and back cameras (side by side or stacked)
- A single record / stop button
- Timer showing elapsed recording time
- No other UI is required

---

## Deliverables

1. **Source code** — clean, buildable project in a Git repository
2. **A short written note** (in the README or a separate doc, 200–400 words) explaining:
   - How you approached the frame-GPS timestamp synchronization problem
   - Any tradeoffs or design decisions you made and why
   - What you would improve given more time
3. **A sample output folder** from a real recording (even a 30-second walk outside is fine) — include the CSVs and metadata.json (videos can be omitted to keep file size small)
