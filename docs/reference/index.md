# Language Reference

Flows is **one language at two altitudes**, sharing a single compiler and a
single per-sample runtime:

- **[Producer mode](./producer)** — assemble high-level standard-library nodes
  (`saw`, `lowpass`, `adsr`, `reverb`) and built-in note schedulers (`poly`,
  `mono`, `arp`). This is how nearly every patch is written.
- **[Developer mode](./developer)** — drop to low-level **primitives** (`phasor`,
  `biquad`, `z1`, `reg`, math) and `def` your own nodes. This is how the standard
  library *itself* is built.

A `.flow` document *is* the instrument: the source text is the single source of
truth for the sound. There is no separate patch format — everything that defines
the sound, including units and note names, lives in the text.

> **Status.** This reference describes the ADC3 engine as it ships today. Each
> entry is marked **implemented**, **self-hosted** (a real `.flow` `def` over
> primitives — the code shown *is* the implementation), **C++ kernel** (a native
> node; the developer-mode code shown is an illustrative equivalent), or
> **deferred** (designed, not yet runnable).

---

## The value model

Today there is exactly **one runtime value type: the signal** — a value carried
sample by sample. A signal has **1 channel (mono)** or **2 channels (stereo)**.

- A bare number or any other literal is a **constant signal**.
- Mono **broadcasts** to stereo automatically: a mono signal `v` acts as
  `{l: v, r: v}` when combined with a stereo signal. Nodes such as `supersaw`,
  `chorus`, and `reverb` produce genuine stereo.
- Arithmetic, filters, and math all operate **per channel**.

There is **no separate `int` or `bool` type**. Comparisons (`gt`, `lt`, …) return
the signals `1.0` / `0.0`, which compose with arithmetic and feed `select`. There
is **no control-rate path**: every signal is audio-rate, recomputed once per
sample per voice.

A small number of arguments are **compile-time** rather than signals (they pick a
fixed structure and cannot vary over time):

| Compile-time argument | Where | Accepted form |
| --- | --- | --- |
| `voices` | `supersaw`, `poly` | integer literal |
| `shape` | `lfo` | enum: `sine` `tri` `saw` `square` `random` |
| `priority` | `mono` | enum: `last` `low` `high` |
| `mode` | `arp` | enum: `up` `down` `updown` `random` |
| `rate`, `octaves` | `arp` | literal |

> **Deferred (P1 typed value system).** Coefficient sets, wavetables (2-D),
> spectra (frequency frames), grain clouds, and sample buffers are designed but
> not yet first-class values. Until then `biquad` takes explicit scalar
> coefficients rather than a `coeffs` bundle.

---

## Units

A number may carry one unit suffix. The parser normalizes each unit to one
**canonical unit**, so a re-saved or agent-edited file diffs cleanly. The source
keeps whichever form you typed (no auto-conversion of the text); the *value* is
canonical.

| Suffix | Quantity | Canonical value | Example |
| --- | --- | --- | --- |
| `hz` | frequency | Hz (×1) | `440hz` → `440` |
| `khz` | frequency | Hz (×1000) | `1.2khz` → `1200` |
| `ms` | time | seconds (×0.001) | `10ms` → `0.01` |
| `s` | time | seconds (×1) | `2.5s` → `2.5` |
| `db` | gain | decibels, signed (×1) | `-6db` → `-6` |
| `c` | pitch offset | cents (×1) | `7c` → `7` |
| `st` | pitch offset | semitones (×1) | `12st` → `12` |
| `%` | ratio | 0..1 (×0.01) | `30%` → `0.3` |
| `1/n` | tempo division | seconds (or Hz for `lfo rate`) | `1/16`, `1/8.`, `1/8t` |
| *(none)* | dimensionless | as written | `0.7` |

**Note names** use scientific pitch notation (`C4`, `A4`, `F#3`, `Bb2`) and a
frequency parameter accepts either a note name or an `hz` value.

Each parameter documents its valid range; out-of-range literals are a soft
warning, and many nodes clamp at the input (e.g. filter `cutoff` to
`[20hz, sr·0.49]`).

---

## The three layers

Every patch has three layers. The scheduling block is the boundary between ① and
②, and `mix()` is the boundary between ② and ③.

```
① note / voice scheduling   poly{} · mono(){} · arp(){}      (note.* lives here)
② per-voice synthesis        name = expr inside the block
   --- mix(voice) ---         collapse the polyphonic stack
③ global / master            name = expr after mix; reverb/delay/master; out
```

`note.*` is available only inside ①/② — referencing it in ③ (after `mix`) is an
error. `out` is the reserved final stereo output.

### Scheduling blocks

```flow
poly { ... }                                  # all held notes sound in parallel
poly(voices: 16) { ... }                      # cap polyphony
mono(glide: 30ms, priority: last) { ... }     # one voice, portamento, note priority
arp(rate: 1/16, mode: up, gate: 0.5, octaves: 1) { ... }   # held chord → arpeggio
arp(rate: 1/16, pattern: [0, 12, 7, 3]) { ... }            # custom step sequence
```

| Block | Parameters | Status |
| --- | --- | --- |
| `poly` | `voices: 16` (max polyphony), `glide: 0ms` | implemented (allocation + stealing) |
| `mono` | `glide: 0ms`, `priority: last \| low \| high` | implemented |
| `arp` | `rate` (tempo division), `mode: up \| down \| updown \| random`, `gate: 0..1`, `octaves: 1..4`, `pattern: [s0, s1, …]` (semitone offsets from the lowest held note; overrides `mode`/`octaves`) | implemented |

Each call inside a block is a **stateful instance**, replicated per voice; that is
the same replication concept as polyphony and unison.

### The note / MIDI namespace

Per-voice (`note.*`) — the note driving this voice:

| Name | Type / range | Meaning | Status |
| --- | --- | --- | --- |
| `note.freq` | signal, hz | frequency of the note | implemented |
| `note.pitch` | signal, 0..127 | MIDI note number | implemented |
| `note.velocity` | signal, 0..1 | note-on velocity | implemented |
| `note.gate` | signal, 0/1 | 1 while held, 0 on release | implemented |
| `note.id` | signal, int | voice/note identifier | implemented |
| `note.epoch` | signal, int | counter that bumps on every (re)trigger — drives `reg`-based retrigger detection | implemented |
| `note.aftertouch` | signal, 0..1 | polyphonic aftertouch | **deferred** |
| `midi.*` | — | `pitchbend`, `modwheel`, `pressure`, `sustain`, `cc[n]` | **deferred** |

---

## Expressions and operators

- **Binary**: `+ - * /` (standard precedence: `* /` bind tighter than `+ -`;
  parentheses group). Division by zero yields `0`.
- **Unary**: `-x`, `+x`.
- **Per-sample**: an expression is evaluated once per sample per instance, so a
  value built from a moving signal moves too: `1.2khz + env*2khz` is a moving
  cutoff because `env` is a signal.

There are **no comparison or boolean operators**. Use the `gt`/`lt`/`gte`/`lte`/`eq`
primitives (which return `1.0`/`0.0`) and `select(cond, a, b)`.

---

## User-defined nodes (`def`)

```flow
def name(param, param: default, ...) = expression      # single-expression body

def name(param, ...) = {           # braced body: local bindings + trailing output
  local = expression               # locals may loop through z1 / delayline / reg
  output_expression
}
```

- Parameters may have defaults; calls pass arguments **positionally or by name**
  (`saw(note.freq, detune: 7c)`).
- The body is either one expression (a sub-graph) or a braced block of local
  bindings ending in a trailing output expression.
- **Each call site is its own instance with its own state** (phase, filter
  memory, delay buffer, registers), so def-local feedback works — e.g. a reusable
  Karplus-Strong string.
- A parameter default may carry an **interface range** `@[lo..hi]`; producer
  call-site literals inherit it as drag bounds on the code surface. Ranges are
  advisory (UI/diagnostics), not a DSP change beyond normal node clamping.
- The standard library is itself a collection of `def`s — see
  [Producer mode](./producer).

---

## Feedback and state

The binding graph is acyclic **except** through an explicit state boundary. A
binding may reference itself — directly or transitively — only while passing
through one of these primitives:

| Boundary | Delay | Use |
| --- | --- | --- |
| `z1(x)` | one sample | difference equations (filters, one-pole loops) |
| `delayline(x, time)` | integer samples | strings, echoes (Karplus-Strong) |
| `reg(x)` | one tick, latched at end of tick | state machines a `z1` loop cannot express (e.g. an ADSR's mutually-recursive stage + level) |

```flow
g = 0.25
y = g*x + (1-g)*z1(y)      # the loop crosses z1 → legal, computable per sample
out = y
```

Current-sample self-reference *outside* a boundary is a `cyclic binding` error.
See [Developer mode](./developer) for the exact semantics of each boundary.

---

## Probes

```flow
probe(voice)        # show the per-voice waveform on the code surface
probe(out)          # show the master output
```

`probe(expr)` taps a signal for inline visualization. Probes are observation
points only — they never affect the audio path.

---

## Status legend

- **implemented** — runs in the ADC3 engine today.
- **self-hosted** — a real `.flow` `def` over primitives; the code shown is the
  shipping implementation.
- **C++ kernel** — a native node; the developer-mode code shown is an
  illustrative equivalent for understanding, not the literal source.
- **deferred** — designed, not yet runnable.
