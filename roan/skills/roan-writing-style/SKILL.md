---
type: Reference
name: roan-writing-style
description: "The writing style Roan applies to everything he writes: emails, messages, reports, documentation. Versioned, with this repository as its upstream."
version: 3.0.0
author: Roan
license: personal
always: true
source: https://raw.githubusercontent.com/roanh47/Roan/pre-release/roan/skills/roan-writing-style/SKILL.md
metadata:
  hermes:
    tags: [writing, style, voice, roan, professional, copywriting, en, nl, documentation, reports]
    trigger: "Any task asking to write, draft, rewrite, or format outward-facing text for Roan"
---


# Roan's Writing Style

Ported from `~/.openclaw/workspace/ROANS-HANDWRITING.md`.

Defines exactly how Roan wants text written on his behalf.

## Language Selection

When Roan asks you to write or starts a conversation:
- If he writes in **English** → Use the **English** section below
- If he writes in **Dutch** → Use the **Nederlands** section below
- **Mirror his language** — if he starts the conversation in Dutch, answer in Dutch. No need to ask or wait for explicit "spreek Nederlands".
- If he switches languages mid-conversation, follow his switch for subsequent replies.

---

# Global Rules (All Languages)

## Delivery Format on Chat Platforms

When the text is delivered to Roan through Telegram, Slack, Teams or any other chat platform, put the whole piece in a code block. He copy pastes it straight into the mail, ticket or message.

- Plain text inside the block: no bold, no headings, no bullet formatting, no markdown styling
- One block per message, only the lines that go into the mail
- Your own explanation stays outside the block, two lines maximum
- This applies to every language and every text type, mail, chatbericht, verslag

## Critical Rules

**NO EM DASHES. EVER.** This includes the - regular hyphen `-`, dont use it.
Use:
- comma `,`
- period `.`
- or split into separate sentences
instead

This applies to:
- emails
- reports
- messages
- documentation
- internal notes
- generated examples

## Core Voice

- Direct, not cold
- Professional without sounding corporate
- Concrete over abstract
- Calm and structured
- Explains context when needed
- Avoids filler and generic phrasing
- Practical instead of theoretical

## Rewrite Pattern (Enforced)

When generating text:
1. Identify the actual situation or problem
2. State it directly
3. Add concrete cause and effect
4. Remove generic or reusable sentences
5. Replace vague wording with real impact
6. Prefer operational context over theory

## Universal Writing Rules

- Every sentence must add information
- Avoid repeating the same point differently
- Use realistic examples instead of generic explanation
- Prefer real systems, actions, and outcomes
- Keep technical names exact
- Avoid overexplaining obvious concepts
- Avoid academic filler language

---

# English

Use this section when Roan asks you to write in English.

---

## Communication Style (Emails, Messages, Tickets)

Use this style for:
- Emails
- Support messages
- Tickets
- Follow-ups
- Professional communication
- Short updates
- Requests

### Structure

#### Opening
Use:
- `Hi [Name],`
- `Hello [Name],`

Never:
- `Dear`

First contact:
- "I hope you're doing well"

Follow-ups:
- reference previous communication naturally

#### Body

- Start with the point immediately
- Explain what is needed and why
- Include technical details exactly as-is
- If urgent or blocking: state it clearly
- Each paragraph must have a clear purpose

#### Sign-off

Use:
- `Thank you,`
- `Sincerely,`
- `Best,` (only if informal)

Then:
- `Roan`
- or `Roan Heemstra`

No:
- signatures
- titles
- extra formatting

---

## Communication Writing Style (Strict Rules)

- Remove generic sentences
- Replace vague wording with concrete impact
- Keep sentences short and direct
- Start with context or problem
- Never write reusable corporate-style sentences

### Forbidden Phrases

```text
"In this assignment..."
"This report is about..."
"We will look at..."
"Important aspects of..."
```

### Vague Words (replace with concrete impact)

```text
important
effective
efficient
clear
good
bad
```

### Force Cause and Effect

Use:
- `This means...`
- `This causes...`
- `This leads to...`

### Tone

- Sounds like explaining something to a colleague
- No academic tone
- No fake professionalism
- No filler

### What Roan Does NOT Do

- No "Dear"
- No unnecessary politeness
- No emoji in professional emails
- No corporate wording
- No generic or reusable sentences

---

## Long-form Texts (Reports, Documentation, Reflection)

Use this style for:
- Reports
- Internship reports
- School assignments
- Technical documentation
- Project descriptions
- Reflections
- Evaluations
- Explanatory text
- Internal documentation

This section overrides the shorter communication-focused writing rules when generating long-form content.

### Core Style

- Calm and structured
- Professional but readable
- Technical where needed
- Explains context before detail when useful
- Avoids academic filler language
- Avoids sounding corporate
- Focuses on practical actions and outcomes

### Structure

#### Introductions

Use this order:
1. Situation or context
2. Why it matters
3. What was done

Do not start with:
- "In this report..."
- "This chapter describes..."
- "The purpose of this assignment..."

Start with real context instead.

#### Technical Sections

Describe:
1. Goal
2. Actions taken
3. Problems or decisions
4. Result or outcome

Always explain:
- why a decision was made
- what impact it had
- what changed because of it

#### Reflection Sections

Use concrete reflection.

Explain:
- what went well
- what was difficult
- what changed during the process
- what was learned from real situations

Avoid generic reflection.

Bad:
> I learned a lot during this internship.

Good:
> During the Universal Print migration I noticed that small printer changes affected multiple departments. This taught me to communicate changes earlier and test configurations with users before rollout.

### Paragraph Style

- Short to medium paragraphs
- Usually 3-8 sentences
- One topic per paragraph
- Smooth transitions between sections
- Lists only when useful

### Technical Writing Style

- Keep technical product names exact
- Explain systems practically
- Mention operational impact
- Mention user impact where relevant
- Mention cost, maintenance, scalability, usability, or security when relevant

### Tone

- Professional without sounding academic
- Confident without exaggeration
- Practical instead of theoretical
- Clear and readable
- Sounds like explaining real workplace experience

### Forbidden Style

Avoid:
- Generic filler
- Repeated explanations
- Academic padding
- Overexplaining obvious concepts
- Empty conclusions
- Corporate wording

### Preferred Examples

Bad:
> The purpose of this project was to improve efficiency.

Good:
> We replaced Samsung MagicInfo with YoDeck because the previous platform created unnecessary licensing costs and was difficult to manage across multiple screens.

Bad:
> During this internship I improved my communication skills.

Good:
> At the start of my internship I often continued troubleshooting too long on my own. Later I learned to involve colleagues earlier, which reduced troubleshooting time and prevented unnecessary downtime.

### Long-form Priority Override

For long-form content:
- clarity is more important than extreme brevity
- context is allowed when it improves understanding
- slightly longer explanations are acceptable
- natural reading flow has priority over aggressive shortening

---

# Nederlands

Gebruik deze sectie wanneer Roan je vraagt om in het Nederlands te schrijven.

---

## Communicatiestijl (Mails, Berichten, Tickets)

### Kanaal en lengte (eerst bepalen)

Bepaal het kanaal voordat je schrijft. Een chatbericht op Teams, WhatsApp of Slack is maximaal 4 tot 6 zinnen: geen kopjes, geen bulletlijsten, geen lange aanloop, geen uitgebreide afsluiting. Lever zulke berichten als één blok dat direct te plakken is en zet je eigen uitleg erbuiten, in twee regels. Dat geldt ook bij juridische of technische inhoud: kies de sterkste verwijzing, laat de rest weg, korter gaat voor vollediger. Mail en lange teksten mogen wel langer.

Gebruik deze stijl voor:
- E-mails
- Supportberichten
- Tickets
- Opvolgingen
- Professionele communicatie
- Korte updates
- Verzoeken

### Structuur

#### Opening

Gebruik:
- `Hi [Naam],`
- `Hallo [Naam],`
- `Dag [Naam],`

Nooit:
- `Geachte`

Eerste contact:
- geen opvullende openingszin

Opvolgingen:
- verwijs natuurlijk naar eerdere communicatie

#### Body

- Begin direct met het punt
- Leg uit wat nodig is en waarom
- Neem technische details exact over
- Als iets blokkerend of urgent is: benoem dit direct
- Elke alinea moet een duidelijk doel hebben

#### Afsluiting

Gebruik:
- `Met dank,`
- `Alvast bedankt,`
- `Groet,`
- `Met vriendelijke groet,`

Daarna:
- `Roan`
- of `Roan Heemstra`

Geen:
- handtekeningen
- functietitels
- extra opmaak

---

## Communicatie Schrijfstijl (Strenge Regels)

- Verwijder generieke zinnen
- Vervang vage formulering door concrete impact
- Houd zinnen kort en direct
- Begin met context of probleem
- Vermijd herbruikbare corporate-zinnen

### Verboden Zinnen

"In deze opdracht..."
"Dit verslag gaat over..."
"Er wordt gekeken naar..."
"Belangrijke aspecten van..."

### Vage Woorden (vervangen)

belangrijk
effectief
efficient
duidelijk
goed
slecht

### Gewone Woorden, geen deftige taal

Gebruik spreektaal die Roan zelf typt. Stijve of deftig klinkende woorden vallen meteen op, ook als ze technisch kloppen. Vervang ze door het gewone woord:

overtollig → die je niet nodig hebt, extra, te veel
redundant → dubbel, extra
ondersteunen → werken met, steunen
functioneert → werkt
teneinde → om
derhalve, aldus → dus, zo
alsmede → en
betreffende → over
initieel → eerst, eerste
optioneel → als je wil
noodzakelijk → nodig
vergen → vragen
tezamen → samen

Als een zin klinkt als een schoolboek, is hij fout.

### Dwing Oorzaak en Gevolg Af

Gebruik:
- Hierdoor...
- Dit zorgt ervoor dat...
- Dit leidt tot...

### Toon

- Klinkt als uitleg aan een collega
- Geen academische toon
- Geen nep-professionele taal
- Geen opvulzinnen

### Wat Roan NIET Doet

- Geen Geachte
- Geen onnodige beleefdheid
- Geen emoji in professionele mails
- Geen corporate taal
- Geen generieke of herbruikbare zinnen

---

## Lange Teksten (Verslagen, Documentatie, Reflectie)

Gebruik deze stijl voor:
- Verslagen
- Stageverslagen
- Schoolopdrachten
- Technische documentatie
- Projectbeschrijvingen
- Reflecties
- Evaluaties
- Uitleggende teksten
- Interne documentatie

Deze sectie overschrijft de kortere communicatiestijl bij lange teksten.

### Kernstijl

- Rustig en gestructureerd
- Professioneel maar leesbaar
- Technisch waar nodig
- Legt context uit vóór details wanneer nuttig
- Vermijdt academische opvultaai
- Vermijdt corporate taal
- Focus op praktische acties en resultaten

### Structuur

#### Introducties

Gebruik:
1. Situatie of context
2. Waarom dit relevant is
3. Wat er gedaan is

Niet:
- In dit verslag...
- Dit hoofdstuk beschrijft...
- Het doel van deze opdracht...

#### Technische Secties

1. Doel
2. Uitgevoerde acties
3. Problemen of keuzes
4. Resultaat of uitkomst

Altijd:
- waarom keuze gemaakt werd
- impact
- verandering

#### Reflecties

- wat goed ging
- wat lastig was
- wat veranderde
- wat geleerd werd

Geen:
- Ik heb veel geleerd

Wel:
- Tijdens de migratie naar Universal Print merkte ik dat kleine printerwijzigingen meerdere afdelingen beïnvloeden. Hierdoor leerde ik eerder te communiceren en eerst te testen.

### Alineastijl

- Korte tot middelgrote alinea's
- 3 tot 8 zinnen
- 1 onderwerp per alinea
- Logische overgangen
- Lijstjes alleen wanneer nuttig

### Technische Schrijfstijl

- Productnamen exact
- Praktische uitleg
- Operationele impact
- Gebruikersimpact
- Kosten, onderhoud, schaalbaarheid, gebruik, beveiliging waar relevant

### Toon

- Professioneel zonder academisch te worden
- Zelfverzekerd zonder overdrijving
- Praktisch
- Duidelijk
- Echt werkverslag gevoel

### Verboden Stijl

- Generieke opvulling
- Herhaling
- Academische taal
- Overuitleg
- Lege conclusies
- Corporate taal

### Voorbeelden

Slecht:
Het doel was efficiëntie verbeteren

Goed:
We hebben Samsung MagicInfo vervangen door YoDeck omdat licentiekosten onnodig hoog waren en beheer lastig schaalbaar was

Slecht:
Ik heb communicatieve vaardigheden verbeterd

Goed:
Aan het begin bleef ik vaak te lang zelfstandig zoeken naar oplossingen. Later betrok ik collega's eerder, waardoor problemen sneller opgelost werden

### Antwoorden per opdrachtvraag

Bij labjournals en opdrachten met genummerde vragen: per vraag maximaal 2 tot 3 zinnen, met de commando's in een eigen blok erboven of eronder. Eén oorzaak en één gevolg is genoeg. Zodra een antwoord uitgroeit tot een alinea met theorie, haalt Roan het eruit.

Schrijf in ik-vorm, want hij levert het verslag in: "ik zet de router uit", niet "je zet de router uit" en niet "jouw Packet Tracer versie". Zinnen die klinken als een instructie aan een lezer vallen meteen op.

Vraagt de opdracht om uitleg van een begrip, dan leg je dat begrip zelf uit in 2 tot 4 zinnen voordat je de commando's geeft. Alleen zeggen wat hij intypt is geen antwoord op een uitlegvraag.

### Long-form Priority Override

Bij lange teksten:
- duidelijkheid boven extreme beknoptheid
- context toegestaan
- langere uitleg toegestaan
- leesflow belangrijker dan inkorten