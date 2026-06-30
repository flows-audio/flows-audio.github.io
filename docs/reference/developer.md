# Developer Mode — Primitive Reference

Developer mode is the low-level instruction set: the minimal stateful/stateless
nodes the engine provides natively. **Everything else — the entire producer
standard library — is built from these.** A `def` composes primitives into a new
node; see [Producer mode](./producer) for the library built on top.

All primitives below are **implemented** in the ADC3 engine.

## Conventions

- **`signal`** — the universal value: a per-sample mono-or-stereo float. A literal
  is a constant signal. See [the value model](./#the-value-model).
- **Per-channel vs mono inputs.** A node's *signal path* (`x`) is processed per
  channel (stereo preserved). **Control inputs** — frequency, cutoff, delay time,
  filter coefficients — read the **left (mono) channel only**. This is noted per
  node.
- **Broadcast.** A mono result acts as `{l, r}` with both channels equal when
  combined with a stereo signal.
- **State.** Each call site is an independent instance with its own state; inside
  a scheduling block it is further replicated per voice.

## Operators

| Form | Meaning |
| --- | --- |
| `a + b`, `a - b`, `a * b`, `a / b` | per-channel arithmetic; `/` by zero yields `0` |
| `-a`, `+a` | unary negate / identity |

There are no comparison or boolean operators — use the compare primitives below.

---

## Oscillator core

### `phasor`

```flow
phasor(freq) -> signal
```

The raw oscillator core: a rising ramp from `0` to `1` at `freq`, the building
block every oscillator is shaped from.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `freq` | signal (hz), mono | `1` | cycles per second |

- **Returns** mono signal in `[0, 1)`.
- **Semantics** — `out = phase; phase += freq/sr;` then wrap into `[0, 1)`.
- **State** — one phase accumulator.

```flow
def raw_saw(freq) = phasor(freq) * 2 - 1     # ramp 0..1 → -1..1
```

---

## Stateless math

All math primitives operate **per channel** and hold **no state**.

### Unary — `sin` `cos` `tanh` `abs` `floor` `exp` `log`

```flow
sin(x) -> signal      cos(x) -> signal      tanh(x) -> signal
abs(x) -> signal      floor(x) -> signal    exp(x) -> signal      log(x) -> signal
```

| Param | Type | Description |
| --- | --- | --- |
| `x` | signal | input, both channels |

- `sin`, `cos` take **radians** (`sin(phasor(f) * 6.28318…)` is a sine tone).
- `tanh` is the saturation/soft-clip curve.
- `log(x)` returns `0` for `x ≤ 0` (guarded).

### Binary — `min` `max` `pow`

```flow
min(x, y) -> signal      max(x, y) -> signal      pow(x, y) -> signal
```

| Param | Type | Description |
| --- | --- | --- |
| `x` | signal | first operand |
| `y` | signal | second operand |

- `pow(x, y) = x^y`; a non-finite result (e.g. negative base, fractional
  exponent) is replaced with `0`.

### `clip`

```flow
clip(x, lo, hi) -> signal
```

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `x` | signal | — | input |
| `lo` | signal | `0` | lower bound |
| `hi` | signal | `1` | upper bound |

- **Returns** `x` clamped to `[lo, hi]` per channel. If `lo > hi` they are
  swapped.

### `samplerate`

```flow
samplerate() -> signal
```

- **No arguments.** Returns the current sample rate (e.g. `48000`) on both
  channels.
- Needed by coefficient math that converts Hz to normalized angular frequency:
  `w0 = 2·π·cutoff / samplerate()`.

---

## Compare and select

The language has no comparison operators, so comparisons are **functions** that
return `1.0` (true) or `0.0` (false) per channel. They compose with arithmetic
and feed `select`, which is how `.flow` defs express gates, band-limited
oscillator branches, and state machines.

### `gt` `lt` `gte` `lte` `eq`

```flow
gt(x, y) -> signal    lt(x, y) -> signal    gte(x, y) -> signal
lte(x, y) -> signal   eq(x, y) -> signal
```

| Param | Type | Description |
| --- | --- | --- |
| `x`, `y` | signal | compared per channel |

- **Returns** `1.0` where the relation holds, else `0.0`.
- Combine for logic: `a AND b` is `gt(a,0.5) * gt(b,0.5)`.

### `select`

```flow
select(cond, a, b) -> signal
```

| Param | Type | Description |
| --- | --- | --- |
| `cond` | signal | per channel: `> 0` chooses `a`, else `b` |
| `a` | signal | value when `cond > 0` |
| `b` | signal | value otherwise |

- **Dataflow blend, not control flow:** *both* `a` and `b` are always evaluated,
  then one is chosen per channel. (A branch whose math produces `NaN`/`inf` is
  safely discarded if it is the unselected side — see `blep` below.)

---

## Filters

### `onepole`

```flow
onepole(x, cutoff) -> signal
```

A one-pole low-pass / smoother.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `x` | signal | — | input, per channel |
| `cutoff` | signal (hz), mono | `1000` | -3 dB corner |

- **Math** — `y += (x - y) · g`, with `g = 1 - exp(-2π·f/sr)` and `f` clamped to
  `[0, sr·0.49]`. `cutoff ≤ 0` freezes the state.
- **State** — one stored sample per channel.

### `biquad`

```flow
biquad(x, b0, b1, b2, a1, a2) -> signal
```

A Direct Form I 2-pole / 2-zero section with **explicit normalized scalar
coefficients** (`a0` already divided out). The whole producer filter family is a
`.flow` def that computes these coefficients from `cutoff`/`q`/`gain`.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `x` | signal | — | input, per channel |
| `b0`,`b1`,`b2` | signal, mono | `1,0,0` | feed-forward (zero) coefficients |
| `a1`,`a2` | signal, mono | `0,0` | feed-back (pole) coefficients |

- **Recurrence** — `y = b0·x + b1·x₁ + b2·x₂ − a1·y₁ − a2·y₂`.
- **State** — `x₁ x₂ y₁ y₂` per channel.
- The feedback lives in the **coefficients**, so no user binding loop is needed.
  Coefficients are signals, so they can be modulated per sample.

> A typed `coeffs` value (so the five args become one bundle) is **deferred** to
> the P1 value system.

---

## State and feedback boundaries

A self-referential binding is legal only through one of these three nodes. They
differ in delay length and, crucially, in *when* they read their input.

### `z1`

```flow
z1(x) -> signal
```

A unit (one-sample) delay — the primitive that legalizes difference-equation
feedback.

| Param | Type | Description |
| --- | --- | --- |
| `x` | signal | input, per channel |

- **Acyclic use** — a true one-sample delay: outputs the previous sample of `x`.
- **In a feedback loop** — `z1(y)` inside the binding for `y` reads **last tick's**
  `y` (the runtime marks a node "computing" before it runs, so the loop reads the
  prior value instead of recursing forever).
- **Eager**: `z1` evaluates `x` when it is read (mid-tick). Good for difference
  equations; for mutually-recursive state use `reg`.

```flow
g = 0.25
y = g*x + (1-g)*z1(y)      # one-pole loop; legal because it crosses z1
```

### `reg`

```flow
reg(x) -> signal
```

A latch register: outputs **last tick's** value and re-reads `x` only at the **end
of the tick** (two-phase capture → commit). This deferred read is what lets a
`.flow` def express a *mutually-recursive* state machine that `z1` cannot — e.g.
an ADSR whose `stage` transition must read the current `level`.

| Param | Type | Description |
| --- | --- | --- |
| `x` | signal | input, latched at end of tick |

- **Read** during the tick returns the stored value; `x` is evaluated once the
  rest of the tick has settled, then latched for next tick.
- A set of registers latch **phase-correctly**: every input is read first, then
  all store, so registers never see each other's new value within one tick.
- Latched per voice with that voice's note context.

See the [`adsr` definition](./producer#adsr) for a worked state machine.

### `delayline`

```flow
delayline(x, time) -> signal
```

A pure delay line: write `x`, read it back `time` later. Unlike the producer
[`delay`](./producer#delay) effect it has **no built-in feedback** — a loop is
written explicitly in source as a binding that passes through `delayline`, the
same kind of state boundary as `z1`, just longer.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `x` | signal | — | input, per channel |
| `time` | signal (s), mono | `0.001` | delay length, clamped to `[1 sample, 1 s]` |

- **Integer-sample** delay: `d = round(time·sr)`, so very high pitches detune
  slightly. (Fractional / variable-rate reads are **deferred**.)
- The buffer is preallocated at compile time, so the audio thread never
  allocates.
- Only `time` ≤ **1 second** is supported (the ring buffer size).

```flow
# Karplus-Strong plucked string: an impulse fed through a delay whose loop
# averages adjacent samples (a gentle low-pass) and decays.
def pluck(freq, decay: 0.5) = {
  d = 1 / freq
  y = exc + decay * (z1(loop) + loop) * 0.5
  loop = delayline(y, d)
  y
}
```

---

## Library defs over primitives

These ship **auto-imported** and are written entirely in developer-mode `.flow`.
They double as the proof that the standard library self-hosts, and as readable
references you can Cmd-click into. A user `def` of the same name overrides them.

### `raw_saw`, `dev_lowpass`

```flow
def raw_saw(freq) = phasor(freq) * 2 - 1          # naive (aliasing) saw
def dev_lowpass(x, cutoff: 1khz) = onepole(x, cutoff)
```

### `blep`

The PolyBLEP residual subtracted at a phasor's wrap (and a pulse edge) to
band-limit the discontinuity. `t` is phase `0..1`, `dt` the per-sample phase
increment.

```flow
def blep(t, dt) = {
  below = lt(t, dt)
  above = gt(t, 1 - dt)
  xb = t / dt
  xa = (t - 1) / dt
  select(below, xb + xb - xb * xb - 1, select(above, xa * xa + xa + xa + 1, 0))
}
```

### `bl_saw`, `bl_square`

Band-limited oscillators over `phasor` + `blep` — **bit-exact** with the C++
[`saw`](./producer#saw) / [`square`](./producer#square) producer kernels.

```flow
def bl_saw(freq, detune: 0) = {
  f = freq * pow(2, detune / 1200)              # cents → ratio
  p = phasor(f)
  dt = f / samplerate()
  2 * p - 1 - blep(p, dt)
}

def bl_square(freq, pw: 0.5, detune: 0) = {
  f = freq * pow(2, detune / 1200)
  p = phasor(f)
  dt = f / samplerate()
  w = clip(pw, 0.05, 0.95)
  base = select(lt(p, w), 1, 0 - 1)
  t2raw = p - w
  t2 = select(lt(t2raw, 0), t2raw + 1, t2raw)   # second edge, wrapped
  base + blep(p, dt) - blep(t2, dt)
}
```
