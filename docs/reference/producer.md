# Producer Mode — Standard Library Reference

Producer mode is the high-level surface: each node is a `def` over
[developer-mode primitives](./developer). This page lists every node with its
signature, parameters, return value, the **mathematical model** behind it, and
the **developer-mode code**.

For each node the developer-mode code is one of:

- **self-hosted** — the `.flow` `def` shown *is* the shipping implementation
  (auto-imported; a user `def` of the same name overrides it);
- **C++ kernel** — a native node kept for performance; the `.flow` shown is an
  illustrative equivalent (and, where noted, bit-exact with the kernel).

Every numeric parameter is drag- and agent-editable on the code surface. Inputs
are [signals](./#the-value-model) unless marked compile-time.

[[toc]]

---

## Oscillators

### `sine`  ·  self-hosted

```flow
sine(freq, phase: 0) -> signal
```

A pure tone.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `freq` | signal (hz / note) | — | frequency |
| `phase` | signal (cycles 0..1) | `0` | phase offset |

- **Returns** mono signal in `[-1, 1]`.
- **Model** — a `phasor` ramp `p ∈ [0,1)`, offset by `phase`, scaled to radians
  and passed through `sin`: `y = sin(2π·(p + phase))`.

```flow
def sine(freq, phase: 0) =
  sin((phasor(freq) + phase) * 6.283185307179586)
```

### `saw`  ·  C++ kernel

```flow
saw(freq, detune: 0c, phase: 0) -> signal
```

Anti-aliased sawtooth.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `freq` | signal (hz / note) | — | frequency |
| `detune` | signal (cents) | `0c` | pitch offset, `f·2^(detune/1200)` |
| `phase` | — | `0` | **deferred** (compile diagnostic if set) |

- **Returns** mono signal in `[-1, 1]`.
- **Model** — a naive ramp `2p − 1` with a **PolyBLEP** residual subtracted at the
  wrap to band-limit the discontinuity (reduce aliasing).
- **Developer-mode equivalent** — [`bl_saw`](./developer#bl-saw-bl-square),
  bit-exact with this kernel:

```flow
def bl_saw(freq, detune: 0) = {
  f = freq * pow(2, detune / 1200)
  p = phasor(f)
  dt = f / samplerate()
  2 * p - 1 - blep(p, dt)
}
```

### `square`  ·  C++ kernel

```flow
square(freq, pw: 0.5, detune: 0c) -> signal
```

Anti-aliased pulse / square.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `freq` | signal (hz / note) | — | frequency |
| `pw` | signal (0.05..0.95) | `0.5` | pulse width (duty cycle) |
| `detune` | signal (cents) | `0c` | pitch offset |

- **Returns** mono signal in `[-1, 1]`.
- **Model** — a pulse that is `+1` while `phase < pw` and `−1` otherwise, with a
  PolyBLEP residual at **each** edge (rising at `0`, falling at `pw`).
- **Developer-mode equivalent** — [`bl_square`](./developer#bl-saw-bl-square),
  bit-exact.

### `triangle`  ·  C++ kernel

```flow
triangle(freq) -> signal
```

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `freq` | signal (hz / note) | — | frequency |

- **Returns** mono signal in `[-1, 1]`.
- **Model** — `y = 4·|p − 0.5| − 1` over the phasor ramp `p` (not band-limited).
- **Developer-mode equivalent** (illustrative):

```flow
def triangle(freq) = {
  p = phasor(freq)
  4 * abs(p - 0.5) - 1
}
```

### `supersaw`  ·  C++ kernel

```flow
supersaw(freq, voices: 7, detune: 25c, width: 0.6) -> stereo
```

The classic detuned unison saw stack.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `freq` | signal (hz / note) | — | centre frequency |
| `voices` | **compile-time** integer | `7` | stack size, clamped `1..64` |
| `detune` | signal (cents) | `25c` | total spread across the stack |
| `width` | signal (0..1) | `0.6` | stereo spread |

- **Returns** stereo signal (`≈ [-1, 1]`, summed and divided by `voices`).
- **Model** — `voices` saws, each detuned to
  `f·2^(posᵢ·detune/1200)` for `posᵢ ∈ [−0.5, 0.5]`, decorrelated start phases,
  each equal-power-panned by `posᵢ·width`, then averaged.
- **Developer-mode equivalent** — **deferred**: needs first-class replication +
  stereo spread, which the language does not yet expose. The per-voice math is a
  detuned [`bl_saw`](./developer#bl-saw-bl-square).

### `noise` · `pnoise`  ·  C++ kernel

```flow
noise() -> signal      pnoise() -> signal
```

- **No arguments.** Both return a mono signal in `[-1, 1]`.
- `noise()` — white noise (xorshift PRNG).
- `pnoise()` — pink noise (Paul Kellet's economy filter on white).
- For sample-and-hold modulation use `lfo(rate, shape: random)`.

---

## Filters

All seven are **self-hosted** RBJ biquads — real `.flow` defs over the
[`biquad`](./developer#biquad) primitive, **bit-exact** with their former C++
kernels. Each clamps the corner frequency to `[20hz, sr·0.49]`. The common shape:

```
w0 = 2π·f / sr      cw = cos(w0)      sw = sin(w0)
alpha = sw / (2·q)                          # peaking/cut filters
```

then the per-type `b`/`a` coefficients are normalized by `a0` and handed to
`biquad`.

### `lowpass` · `highpass` · `bandpass` · `notch`

```flow
lowpass(x, cutoff: 1khz, q: 0.707)  -> signal
highpass(x, cutoff: 1khz, q: 0.707) -> signal
bandpass(x, cutoff: 1khz, q: 2)     -> signal
notch(x, cutoff: 1khz, q: 0.707)    -> signal
```

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `x` | signal | — | input, per channel |
| `cutoff` | signal (hz), mono | `1khz` | corner frequency; `lowpass` carries interface range `@[20hz..20khz]` |
| `q` | signal, mono | `0.707` (`2` for `bandpass`) | resonance; `lowpass` carries `@[0.05..12]` |

`lowpass` (the model for the family):

```flow
def lowpass(x, cutoff: 1khz @[20hz..20khz], q: 0.707 @[0.05..12]) = {
  f = clip(cutoff, 20, samplerate() * 0.49)
  w0 = 6.283185307179586 * f / samplerate()
  cw = cos(w0)
  sw = sin(w0)
  alpha = sw / (2 * max(q, 0.05))
  a0 = 1 + alpha
  a1 = 0 - 2 * cw
  a2 = 1 - alpha
  b0 = (1 - cw) / 2
  b1 = 1 - cw
  b2 = (1 - cw) / 2
  biquad(x, b0/a0, b1/a0, b2/a0, a1/a0, a2/a0)
}
```

The three siblings differ only in the feed-forward (`b`) coefficients:

| Node | `b0` | `b1` | `b2` |
| --- | --- | --- | --- |
| `highpass` | `(1+cw)/2` | `−(1+cw)` | `(1+cw)/2` |
| `bandpass` | `alpha` | `0` | `−alpha` |
| `notch` | `1` | `−2·cw` | `1` |

### `lowshelf` · `highshelf`

```flow
lowshelf(x, freq: 1khz, gain: 0)  -> signal
highshelf(x, freq: 1khz, gain: 0) -> signal
```

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `x` | signal | — | input |
| `freq` | signal (hz), mono | `1khz` | shelf corner |
| `gain` | signal (db), mono | `0` | shelf gain in decibels |

- **Model** — RBJ shelving with slope `S = 1`. Linear gain `A = 10^(gain/40)`;
  `alpha = sin(w0)/2·√2`; `tsa = 2·√A·alpha`.

```flow
def lowshelf(x, freq: 1khz, gain: 0) = {
  f = clip(freq, 20, samplerate() * 0.49)
  w0 = 6.283185307179586 * f / samplerate()
  cw = cos(w0)
  sw = sin(w0)
  A = pow(10, gain / 40)
  alpha = sw / 2 * pow(2, 0.5)
  tsa = 2 * pow(A, 0.5) * alpha
  b0 = A * ((A + 1) - (A - 1) * cw + tsa)
  b1 = 2 * A * ((A - 1) - (A + 1) * cw)
  b2 = A * ((A + 1) - (A - 1) * cw - tsa)
  a0 = (A + 1) + (A - 1) * cw + tsa
  a1 = 0 - 2 * ((A - 1) + (A + 1) * cw)
  a2 = (A + 1) + (A - 1) * cw - tsa
  biquad(x, b0/a0, b1/a0, b2/a0, a1/a0, a2/a0)
}
```

`highshelf` uses the same `A`/`alpha`/`tsa` with the shelf-direction signs
flipped (it boosts/cuts above `freq` instead of below).

### `peak`

```flow
peak(x, freq: 1khz, gain: 0, q: 1) -> signal
```

A peaking / bell EQ.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `x` | signal | — | input |
| `freq` | signal (hz), mono | `1khz` | centre, range `@[20hz..20khz]` |
| `gain` | signal (db), mono | `0` | bell gain, range `@[-24db..24db]` |
| `q` | signal, mono | `1` | bandwidth, range `@[0.05..12]` |

```flow
def peak(x, freq: 1khz @[20hz..20khz], gain: 0 @[-24db..24db], q: 1 @[0.05..12]) = {
  f = clip(freq, 20, samplerate() * 0.49)
  w0 = 6.283185307179586 * f / samplerate()
  cw = cos(w0)
  sw = sin(w0)
  A = pow(10, gain / 40)
  alpha = sw / (2 * max(q, 0.05))
  b0 = 1 + alpha * A
  b1 = 0 - 2 * cw
  b2 = 1 - alpha * A
  a0 = 1 + alpha / A
  a1 = 0 - 2 * cw
  a2 = 1 - alpha / A
  biquad(x, b0/a0, b1/a0, b2/a0, a1/a0, a2/a0)
}
```

---

## Envelopes & modulators

### `adsr`  ·  self-hosted

```flow
adsr(a: 10ms, d: 100ms, s: 0.7, r: 200ms) -> signal
```

A classic attack/decay/sustain/release envelope. **Gate and retrigger are read
implicitly** from the voice (`note.gate`, `note.epoch`) — they are *not*
parameters.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `a` | signal (s) | `10ms` | attack time |
| `d` | signal (s) | `100ms` | decay time |
| `s` | signal (0..1) | `0.7` | sustain level |
| `r` | signal (s) | `200ms` | release time |

- **Returns** a mono envelope signal in `[0, 1]`, typically multiplied into the
  amplitude or added into a cutoff.
- **Model** — a Mealy state machine with `stage ∈ {1:A, 2:D, 3:S, 4:R, 0:Idle}`
  and a `level`, both held in [`reg`](./developer#reg) latches. Each tick the
  next `stage`/`level` is computed from the current ones plus gate edges; `reg`'s
  end-of-tick latch is what lets the `stage` transition read the freshly-computed
  `level`. A bump in `note.epoch` retriggers from `0`.

```flow
def adsr(a: 10ms, d: 100ms, s: 0.7, r: 200ms) = {
  sr = samplerate()
  g = note.gate
  ep = note.epoch
  pg = reg(g)  pep = reg(ep)  pl = reg(lvl)  ps = reg(stage)  pr = reg(rel)
  retrig = gt(ep, pep)
  rising = gt(g, 0.5) * lt(pg, 0.5)
  falling = lt(g, 0.5) * gt(pg, 0.5)
  rel = select(falling, pl, pr)
  plBase = select(retrig, 0, pl)
  active = select(retrig, 1, select(rising, 1, select(falling, 4, ps)))
  aInc = select(gt(a, 0), 1 / (a * sr), 2)
  dDec = select(gt(d, 0), (1 - s) / (d * sr), 2)
  rDec = select(gt(r, 0), rel / (r * sr), 2)
  lvlA = min(plBase + aInc, 1)
  lvlD = max(plBase - dDec, s)
  lvlR = max(plBase - rDec, 0)
  lvl = select(eq(active, 1), lvlA,
        select(eq(active, 2), lvlD,
        select(eq(active, 3), s,
        select(eq(active, 4), lvlR, 0))))
  stage = select(eq(active, 1), select(gte(lvl, 1), 2, 1),
          select(eq(active, 2), select(lte(lvl, s), 3, 2),
          select(eq(active, 4), select(lte(lvl, 0), 0, 4),
          active)))
  lvl
}
```

### `lfo`  ·  C++ kernel

```flow
lfo(rate, shape: sine, phase: 0) -> signal
```

A low-frequency modulator.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `rate` | signal (hz) or tempo division | — | speed; a tempo division means cycles per that note (Hz), not seconds |
| `shape` | **compile-time** enum | `sine` | `sine` `tri` `saw` `square` `random` |
| `phase` | — | `0` | **deferred** |

- **Returns** mono signal in `[-1, 1]`.
- **Model** — a phasor at `rate`, mapped per shape: `sine` = table lookup; `tri`
  = `4·|p−0.5|−1`; `saw` = `2p−1`; `square` = `±1` at the half-cycle; `random` =
  sample-and-hold (a new value latched each cycle).

> A developer-mode `def` over `phasor` + `select` can express `sine/tri/saw/square`
> directly; `random` additionally needs an RNG primitive (not yet exposed).

---

## Effects

Usable in layer ② (per-voice timbre) or ③ (master). Reverb/delay/chorus/drive
that define the sound belong in the patch; bus mixing and sidechain belong in the
DAW.

### `drive`  ·  self-hosted

```flow
drive(x, amount: 0.3) -> signal
```

`tanh` saturation / soft overdrive.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `x` | signal | — | input |
| `amount` | signal | `0.3` | drive amount |

- **Model** — pre-gain then `tanh`: `y = tanh(x·(1 + amount·5))`.

```flow
def drive(x, amount: 0.3) =
  tanh(x * (1 + amount * 5))
```

### `delay`  ·  C++ kernel

```flow
delay(x, time, feedback: 0.3, mix: 0.25) -> signal
```

A feedback delay line.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `x` | signal | — | input |
| `time` | signal (s) or tempo division, mono | `0.25` | delay length, max `2s` |
| `feedback` | signal (0..0.95), mono | `0.3` | regeneration amount |
| `mix` | signal (0..1), mono | `0.25` | dry/wet blend |

- **Model** — integer-sample delay; the buffer stores `x + delayed·feedback`
  (internal regeneration); output is `x·(1−mix) + delayed·mix`.
- **Developer-mode equivalent** — expressible from
  [`delayline`](./developer#delayline) + a `z1`/binding feedback loop (a `def`'s
  built-in `delay` requires `time ≤ 1s`, the `delayline` limit):

```flow
def echo(x, time, feedback: 0.3, mix: 0.25) = {
  wet = delayline(x + feedback * z1(wet), time)
  x * (1 - mix) + wet * mix
}
```

### `chorus`  ·  C++ kernel

```flow
chorus(x, rate: 0.3hz, depth: 0.4, mix: 0.5) -> stereo
```

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `x` | signal | — | input |
| `rate` | signal (hz), mono | `0.3hz` | LFO speed |
| `depth` | signal (0..1), mono | `0.4` | modulation depth |
| `mix` | signal (0..1), mono | `0.5` | dry/wet blend |

- **Model** — a delay of `15ms ± 5ms·depth·sin(2π·lfo)`; the right channel taps a
  quarter-cycle ahead for stereo width.
- **Developer-mode equivalent** — **deferred**: needs a fractional (interpolated)
  delay read, which `delayline` does not yet provide.

### `reverb`  ·  C++ kernel

```flow
reverb(x, size: 0.7, decay: 2s, mix: 0.25, predelay: 0ms) -> stereo
```

A compact Schroeder reverb (4 parallel comb filters + 2 series allpass).

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `x` | signal | — | input |
| `size` | signal (0..1), mono | `0.7` | room size |
| `decay` | signal (s), mono | `2s` | decay time |
| `mix` | signal (0..1), mono | `0.25` | dry/wet blend |
| `predelay` | — | `0ms` | **deferred** |

- **Model** — feedback `fb = min(0.5 + size·0.4 + decay·0.02, 0.96)` feeds 4 combs;
  their sum passes through 2 allpass sections; the right channel offsets each
  buffer by a fixed stereospread for L/R decorrelation.
- **Developer-mode equivalent** — **deferred** (a network of `delayline` + `z1`
  feedback; the kernel stays for performance).

---

## Utility

### `mix`  ·  C++ kernel (layer boundary)

```flow
mix(voice, gain: 0db) -> signal
```

Collapses the per-voice polyphonic stack into one global signal — the boundary
between layer ② and ③.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `voice` | signal (per-voice) | — | the per-voice expression to sum |
| `gain` | signal (db) | `0db` | optional gain staging |

- **Model** — holds one independent copy of the voice subgraph per voice,
  evaluates each with that voice's note state, and **sums** them (then applies
  `gain`). Distinct instances per voice give each its own phase / filter memory /
  envelope — that is what makes real polyphony work.
- `mix()` does **not** normalize a chord. Leave headroom:
  `mix(voice, gain: -6db)`.

### `pan`  ·  C++ kernel

```flow
pan(x, pos: 0) -> stereo
```

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `x` | signal | — | input |
| `pos` | signal (-1..1), mono | `0` | −1 = left, 0 = centre, +1 = right |

- **Model** — equal-power balance: `ang = (pos+1)·π/4`,
  `L = x.l·cos(ang)`, `R = x.r·sin(ang)`.
- **Developer-mode equivalent** — **deferred**: needs per-channel (L/R) access,
  which the language does not yet expose.

### `gain`  ·  C++ kernel

```flow
gain(x, level: 0db) -> signal
```

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `x` | signal | — | input |
| `level` | signal (db), mono | `0db` | gain in decibels |

- **Model** — `y = x · 10^(level/20)`.
- **Developer-mode equivalent** (illustrative):

```flow
def gain(x, level: 0) =
  x * pow(10, level / 20)
```
