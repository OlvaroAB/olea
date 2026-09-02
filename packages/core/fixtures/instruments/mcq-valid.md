---
course: LITHO204
week: 3
---

## Quiz items she typed herself

```olea-mcq
stem: Which silicate crystallises earliest out of a cooling magma?
answer: Olivine
distractor: Quartz
distractor: Feldspar
distractor: Calcite
distractor: Garnet
distractor: Amphibole
feedback: Quartz is the last of the common silicates to crystallise, not the first.
id: mcq-crystallisation-1
```

A pool of five, so three sampled per presentation leaves genuine room to rotate.

```olea-mcq
stem: Which of these is metamorphic rather than igneous or sedimentary?
answer: Gneiss
distractor: Basalt
distractor: Granite
```

The floor case (`[D-195]`, lowered from four to two): exactly two distractors, no feedback, no
id — the documented minimum an MCQ can be and still parse. It does not rotate — there is nothing
left to sample from once the whole pool is shown — but it presents, shuffled, rather than being
padded with an invented distractor or withheld outright (`mcq-present.ts`'s short-pool degrade).
