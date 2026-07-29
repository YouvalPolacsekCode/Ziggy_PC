# IR Walk Wizard + Auto-Analyzer + Cloud Registry — Session Brief

(Handed off 2026-07-29 from the protocol-cracking session. The chat prompt the
user pasted is the authoritative copy; this file mirrors it for reference.)

## Mission
1. Walk Wizard — guided in-app capture flow for any AC remote.
2. Auto-Analyzer — ordered captures -> protocol card (services/ir_protocol_cards.py format).
3. Cloud Protocol Registry — cards sync via the relay; second home with same remote = instant support.

## Foundation (branch feature/ir-state-engine-r3)
- services/ir_protocol_cards.py — card format + generic decode/encode engine. Cards:
  tadiran_v1 (REAL-HW VALIDATED), toshiba_electra_v0 + midea_tornado_v0 (experimental).
- services/ir_protocol.py — pulse decoders, fingerprints, raw parse/encode. Listener logs
  payload/payload2/raw b64 per AC capture.
- services/ir_listener.py — RX loop, stateful-AC guard, pause_event; services/ir_metrics.py RX stats.
- services/ir_manager.py — card-driven TX synthesis (_tx_card_for_device, synthesizable_commands).

## The method to automate (how Tadiran was cracked by hand)
Temp ladder monotonic-fit (tolerate RX misses ~7%); mode cycle (a mode press may ALSO change fan);
fan cycle wrap; swing flag flip; power classification into (a) real power bit (Midea),
(b) alternating toggle marker without direction (Tadiran byte5 c0/30), (c) settings-frame-implies-on;
checksum search nibble_sum/byte_sum/xor over all captures; structure discovery first
(leader, pulse-distance vs pulse-pair-inversion, bit count, LSB/MSB via constant header bytes,
halves that may differ, duplicate captures within ~2s); const bytes.

## Killer regression test
tests/test_ir_protocol_cards.py::TADIRAN_REAL holds 27 real pinned payloads in walk order.
The analyzer MUST re-derive a card equivalent to TADIRAN_V1 from a reconstructed session.

## Wizard UX
Ziggy-native only (no HA terms/entity_ids), Hebrew+RTL, baseline "cool/24/auto/swing-off/ON",
per-press "heard it" confirmation, ask user what AC shows on mode/fan steps and what it DID on
power steps, finish with 3 synthesized validation commands; tx_validated flips ONLY on
user-confirmed obedience (real-life validation gate is absolute). Handle resume/abort/misses and
the Broadlink RX wedge (3+ unheard presses -> ask user to power-cycle blaster).

## Registry
Local-first (hub JSON merged with built-in CARDS); relay sync (https://ziggy-relay.fly.dev),
anonymized; lookup by frame-structure fingerprint; immutable card versions + validation counters.

## Ground rules
Branch feature/ir-walk-wizard off latest origin/feature/ir-state-engine-r3; another session works
on r3 — pull before merging; ONE deployer at a time, ask the user; never push main. Hub deploy:
ssh ziggy@10.100.102.15, /opt/ziggy, sudo git pull, sudo env GIT_SHA=$(sudo git rev-parse --short HEAD)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build ziggy (GIT_SHA mandatory
for phone OTA; bundle applies over two app launches). TDD; pinned real captures are sacred; full suite
has 23+2 pre-existing failures unrelated to IR. The app's AC card renders from legacy ac_memory — WS
events must carry an ac_state block to move it.

## Milestones
1) Analyzer offline vs historic Tadiran session -> TADIRAN_V1. 2) Capture-session backend.
3) Wizard UI + validation pass. 4) Registry. 5) E2E dry run on the user's Tadiran (registry hit).
