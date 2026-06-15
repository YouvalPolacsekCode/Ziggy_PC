/**
 * External-converter template for HOBEIAN Tuya-OEM Zigbee devices.
 *
 * Use ONLY if Z2M's built-in converters don't pick the device up
 * (i.e., the device shows up with "Definition: undefined" or with only
 * raw DP entities). If Z2M handles the device cleanly out of the box,
 * delete this file — duplicate definitions cause conflicts.
 *
 * To deploy:
 *   1. Copy this file to docker/z2m-data/external_converters/hobeian.js
 *   2. Edit configuration.yaml on the canary, adding:
 *        external_converters:
 *          - external_converters/hobeian.js
 *   3. Restart Z2M:
 *        docker compose --profile zigbee-z2m restart zigbee2mqtt
 *
 * Confirmed devices on the canary (from ZHA's node descriptors):
 *   - HOBEIAN CK-BL702-MWS-01(7016)  — mmWave human presence + lux
 *   - HOBEIAN ZG-303Z                 — Tuya temp/humidity (+ presence?)
 *
 * Both have IEEE prefix a4:c1:38:* (Tuya OUI) and expose Tuya cluster
 * 0xEF00. They communicate via Tuya DataPoints, not standard ZCL
 * clusters — the converter has to translate DP IDs to entity names.
 *
 * The DP IDs below are EDUCATED GUESSES based on common Tuya mmWave
 * radars (e.g., TS0601-based presence sensors). You'll need to observe
 * the device's actual DPs at runtime:
 *
 *   docker compose --profile zigbee-z2m logs -f zigbee2mqtt | grep -i "datapoint"
 *
 * Each unknown DP will log as `Received unhandled DP <id>` with the raw
 * payload — that's how you learn the real mapping.
 */

const fz = require('zigbee-herdsman-converters/converters/fromZigbee');
const tz = require('zigbee-herdsman-converters/converters/toZigbee');
const exposes = require('zigbee-herdsman-converters/lib/exposes');
const tuya = require('zigbee-herdsman-converters/lib/tuya');
const e = exposes.presets;
const ea = exposes.access;

module.exports = [
    {
        // CK-BL702-MWS-01(7016) — mmWave human presence center.
        // ManufacturerName / model values are what the device REPORTS
        // (HOBEIAN-branded), distinct from the Z2M model alias below.
        fingerprint: tuya.fingerprint('TS0601', ['_TZE200_ck-bl702']),
        // OR if the device reports HOBEIAN-prefixed model:
        // zigbeeModel: ['CK-BL702-MWS-01'],
        model: 'CK-BL702-MWS-01',
        vendor: 'HOBEIAN',
        description: 'mmWave human presence sensor with illuminance (Tuya OEM)',
        fromZigbee: [tuya.fz.datapoints],
        toZigbee: [tuya.tz.datapoints],
        onEvent: tuya.onEvent({timeStart: '1970'}),
        configure: tuya.configureMagicPacket,
        exposes: [
            e.presence(),
            e.illuminance_lux(),
            // Sensitivity / fading_time / distance commonly map to DPs:
            e.numeric('sensitivity', ea.STATE_SET).withValueMin(1).withValueMax(9)
                .withDescription('Presence detection sensitivity (higher = more sensitive)'),
            e.numeric('keep_time', ea.STATE_SET).withValueMin(5).withValueMax(3600).withUnit('s')
                .withDescription('Seconds presence is held after last detection'),
        ],
        meta: {
            tuyaDatapoints: [
                [1, 'presence', tuya.valueConverter.trueFalse1],
                [2, 'sensitivity', tuya.valueConverter.raw],
                [4, 'keep_time', tuya.valueConverter.raw],
                [104, 'illuminance_lux', tuya.valueConverter.raw],
                // Add more DPs as they're discovered in the logs.
            ],
        },
    },
    {
        // ZG-303Z — Tuya temp/humidity (+ possible presence).
        // Cluster fingerprint from the ZHA dump showed:
        //   0xEF00 (Tuya), 0x0402 (TempMeasurement), 0x0405 (RelHumidity),
        //   0x0001 (PowerConfiguration). Battery-powered.
        fingerprint: tuya.fingerprint('TS0601', ['_TZE200_zg303z']),
        model: 'ZG-303Z',
        vendor: 'HOBEIAN',
        description: 'Tuya temperature/humidity sensor (battery)',
        fromZigbee: [tuya.fz.datapoints],
        toZigbee: [tuya.tz.datapoints],
        onEvent: tuya.onEvent({timeStart: '1970'}),
        configure: tuya.configureMagicPacket,
        exposes: [
            e.temperature(),
            e.humidity(),
            e.battery(),
        ],
        meta: {
            tuyaDatapoints: [
                [1, 'temperature', tuya.valueConverter.divideBy10],
                [2, 'humidity', tuya.valueConverter.raw],
                [4, 'battery', tuya.valueConverter.raw],
            ],
        },
    },
];
