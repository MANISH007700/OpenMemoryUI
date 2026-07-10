# Hyperframes Composition Brief: OpenMemoryUI

## Objective
Create a short launch-style brag video for OpenMemoryUI.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape - 1920x1080
- Duration: 21.5 seconds

## Source Material
- Project root: `/Users/DLP-I516-206/Desktop/memory`
- Primary files read: `index.html`, `README.md`
- Product name: OpenMemoryUI / Memory Glassbox
- Tagline / strongest claim: "Talk to an agent whose memory is a glass box."
- Key UI or visual moment to recreate: chat input plus five-stage pipeline writing into four memory stores.
- Copy that must appear verbatim:
  - "Talk to an agent whose memory is a glass box."
  - "Every message you send is traced through a real memory pipeline."
  - "receive -> retrieve -> generate -> extract -> write"
  - "Transparent agentic memory, ready to launch."

## Creative Direction
- Tone preset: app-store
- Creative direction: polished product-launch demo for an AI memory debugger
- Interpretation: Feature-forward, clean, high-readability dark UI with restrained launch energy.
- Angle: Most AI memory demos ask for trust; OpenMemoryUI opens the casing and shows every store, score, write, and provenance trail.
- Hook: "Memory isn't magic. It's traceable."
- Outro / punchline: "OpenMemoryUI. Transparent agentic memory, ready to launch."
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign
  - Hiding the actual UI behind atmospheric effects

## Visual Identity
- Background: #0d141f
- Text: #e8eef5
- Accent: #57e6c4
- Additional store colors: #6fd3ff, #ffb454, #a78bfa
- Display font: Bricolage Grotesque or system fallback
- Body font: Atkinson Hyperlegible or system fallback
- Visual references from the project: top bar brand dots, chat hero, five-stage pipeline, memory panels, contextual score bars, memory bus log, provenance drawer.

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. Hook - 3.2s - product name and "Memory isn't magic. It's traceable."
2. Reveal the Glassbox - 3.8s - real app-style frame with chat, pipeline, memory stores.
3. One Message Through the Pipeline - 4.8s - sample user message, Send click, five pipeline stages activate.
4. Memory Writes Become Visible - 5.1s - cards write into session, semantic, episodic, contextual, with log lines.
5. Provenance and Outro - 4.6s - provenance drawer, final logo and tagline.

## Audio
- Audio role: warm bed with sparse professional accents.
- Audio arc: music starts immediately, holds under UI motion, final logo gets one restrained bell.
- Music: `assets/music/happy-beats-business-moves-vol-11-by-ende-dot-app.mp3`
- Music treatment: volume 0.34, 21.5s duration; composition may visually fade on final hold.
- Music cue guidance: bundled preset source `/tmp/brag/skills/brag/assets/music/cues/happy-beats-business-moves-vol-11-by-ende-dot-app.music-cues.json`, tempo 114.84 BPM. Useful targets: 1.60s, 3.70s, 8.96s, 12.65s, 17.91s, 20.54s.
- Audio-reactive treatment: subtle if practical; use glow/card presence only. If extraction is unavailable, skip without blocking.
- Audio-coupled moments:
  - Scene 1 - product hook reveal
  - Scene 2 - app frame reveal
  - Scene 3 - Send click and pipeline stages
  - Scene 4 - memory cards writing
  - Scene 5 - final logo lockup
- SFX selection guidance: low-risk click/drop/soft impact sounds, final bell at restrained volume.
- SFX analysis guidance: `/tmp/brag/skills/brag/assets/sfx/sfx-analysis.md`
- Exact SFX choice: Hyperframes should choose filenames, timestamps, density, and volume based on the implemented animation.
- Audio files: copied into `brag-output/composition/assets/`.

## Hyperframes Instructions
Use the current Hyperframes CLI workflow and the local composition contract.

Requirements:
- Show at least one real UI, copy, or visual element from the source project.
- Keep all text readable in the final render.
- Keep the video within 15-25 seconds.
- Include the planned music/SFX layer.
- Treat music cue metadata as optional timing hints.
- Use local assets for audio.
- Run Hyperframes lint, validate, inspect, snapshot or render checks before delivery.
