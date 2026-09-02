---
course: LITHO204
---

## Blocks that announce themselves as MCQs and are not

Each block below fails for exactly one reason, named in the paragraph above it. The parser must
report every one of them — with its reason and its location — rather than skipping it, because a
quiz item that vanishes silently is worse than one that never existed: she wrote it, she expects
to see it, and nothing tells her why she does not.

One distractor. Below the pool floor (`[D-195]` lowered it from four to two), this is not a
slightly-worse MCQ, it is a different instrument wearing the name — a single grounded distractor
is a true/false item, not an MCQ.

```olea-mcq
stem: Which of these is metamorphic rather than igneous?
answer: Gneiss
distractor: Basalt
```

No stem.

```olea-mcq
answer: Olivine
distractor: Quartz
distractor: Feldspar
distractor: Calcite
distractor: Garnet
```

No answer.

```olea-mcq
stem: Which silicate crystallises earliest out of a cooling magma?
distractor: Quartz
distractor: Feldspar
distractor: Calcite
distractor: Garnet
```

Two answers, which is two instruments pretending to be one.

```olea-mcq
stem: Which silicate crystallises earliest out of a cooling magma?
answer: Olivine
answer: Quartz
distractor: Feldspar
distractor: Calcite
distractor: Garnet
distractor: Amphibole
```

A repeated distractor. The count says five; the pool is four, and nothing would have said so.

```olea-mcq
stem: Which silicate crystallises earliest out of a cooling magma?
answer: Olivine
distractor: Quartz
distractor: Feldspar
distractor: Quartz
distractor: Calcite
distractor: Garnet
```

A field name that is nearly right. Silence here means a typo costs her a distractor she thought
she had written.

```olea-mcq
stem: Which silicate crystallises earliest out of a cooling magma?
answer: Olivine
distractors: Quartz
distractor: Feldspar
distractor: Calcite
distractor: Garnet
distractor: Amphibole
```

A field with no value at all.

```olea-mcq
stem:
answer: Olivine
distractor: Quartz
distractor: Feldspar
distractor: Calcite
distractor: Garnet
```

A line that is not a field at all.

```olea-mcq
stem: Which silicate crystallises earliest out of a cooling magma?
answer: Olivine
just some prose she pasted in by accident
distractor: Quartz
distractor: Feldspar
distractor: Calcite
distractor: Garnet
```
