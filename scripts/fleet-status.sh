#!/usr/bin/env bash
# Fleet status CLI for multi-home Ziggy deployments.
# Reads scripts/fleet.yml (list of {name, url}) and prints one row per home
# with SHA, uptime, HA-configured flag, and last deploy timestamp.
# Exits 0 iff every home responded and is on the same git_sha. Otherwise 1.
# Pure bash + curl + python3 (no jq, no yaml deps) so it runs on stock macOS.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLEET_YML="${REPO_DIR}/scripts/fleet.yml"

VERBOSE=0
RELAY_URL="${ZIGGY_RELAY_URL:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    -v|--verbose) VERBOSE=1; shift ;;
    --from-relay)
      RELAY_URL="$2"; shift 2 ;;
    -h|--help)
      cat <<'EOF'
Usage: ./scripts/fleet-status.sh [-v] [--from-relay <RELAY_URL>]

  -v, --verbose            Print raw JSON responses under the table.
  --from-relay <URL>       Fetch the home list from
                           $URL/api/admin/fleet/homes instead of the
                           static scripts/fleet.yml file.
                           Requires $ZIGGY_RELAY_ADMIN_JWT in the
                           environment. Falls back to the static file
                           if the request fails.

  ZIGGY_RELAY_URL env var  Default value for --from-relay if unset.
  -h, --help               Show this message.
EOF
      exit 0
      ;;
    *) shift ;;
  esac
done

NAMES=()
URLS=()
SOURCE="fleet.yml"

# ----------------------------------------------------------------------------
# Source A: relay's DB-backed fleet endpoint (Phase 4). Fetches
#   [{id, name, type, tunnel_url, status, subscription_state}, ...]
# from $RELAY_URL/api/admin/fleet/homes. Requires ZIGGY_RELAY_ADMIN_JWT.
# On any failure, falls through silently and tries fleet.yml.
# ----------------------------------------------------------------------------
if [[ -n "$RELAY_URL" ]]; then
  if [[ -z "${ZIGGY_RELAY_ADMIN_JWT:-}" ]]; then
    echo "WARN: --from-relay given but ZIGGY_RELAY_ADMIN_JWT not set — falling back to $FLEET_YML" >&2
  else
    relay_json="$(curl -fsS --max-time 10 \
      -H "Authorization: Bearer $ZIGGY_RELAY_ADMIN_JWT" \
      "${RELAY_URL%/}/api/admin/fleet/homes" 2>/dev/null || true)"
    if [[ -n "$relay_json" ]]; then
      # Parse JSON into TSV `name<TAB>url` pairs.
      while IFS=$'\t' read -r n u; do
        [[ -z "$n" || -z "$u" ]] && continue
        NAMES+=("$n"); URLS+=("$u")
      done < <(python3 - "$relay_json" <<'PY'
import json, sys
try:
    data = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)
for h in data.get("homes", []):
    n = h.get("name") or h.get("id") or ""
    u = h.get("tunnel_url") or ""
    if n and u:
        print(f"{n}\t{u}")
PY
      )
      if [[ "${#NAMES[@]}" -gt 0 ]]; then
        SOURCE="relay ($RELAY_URL)"
      fi
    fi
    if [[ "${#NAMES[@]}" -eq 0 ]]; then
      echo "WARN: relay returned no homes — falling back to $FLEET_YML" >&2
    fi
  fi
fi

# ----------------------------------------------------------------------------
# Source B (fallback): static fleet.yml. Format is intentionally simple:
# a `homes:` list of `{ name, url }` items. We grep out `name:` and `url:`
# lines in order and pair them up (no YAML dep on a stock macOS install).
# ----------------------------------------------------------------------------
if [[ "${#NAMES[@]}" -eq 0 ]]; then
  if [[ ! -f "$FLEET_YML" ]]; then
    echo "ERROR: $FLEET_YML not found and no homes from relay."
    echo "Create it with at least one entry, or pass --from-relay with a valid ZIGGY_RELAY_ADMIN_JWT."
    exit 2
  fi
  while IFS= read -r line; do
    trimmed="${line#"${line%%[![:space:]]*}"}"  # ltrim
    case "$trimmed" in
      "- name:"*|"-name:"*)
        val="${trimmed#*name:}"
        val="${val#"${val%%[![:space:]]*}"}"
        NAMES+=("$val")
        ;;
      "name:"*)
        val="${trimmed#name:}"
        val="${val#"${val%%[![:space:]]*}"}"
        NAMES+=("$val")
        ;;
      "url:"*)
        val="${trimmed#url:}"
        val="${val#"${val%%[![:space:]]*}"}"
        URLS+=("$val")
        ;;
    esac
  done < "$FLEET_YML"

  if [[ "${#NAMES[@]}" -eq 0 || "${#URLS[@]}" -ne "${#NAMES[@]}" ]]; then
    echo "ERROR: $FLEET_YML did not parse into a usable list of {name, url} pairs."
    echo "Found ${#NAMES[@]} name(s) and ${#URLS[@]} url(s)."
    exit 2
  fi
fi

if [[ "$VERBOSE" -eq 1 ]]; then
  echo "source: $SOURCE" >&2
fi

# ----------------------------------------------------------------------------
# Fan out: per-home, in parallel, fetch /api/version and /api/__deploy__.
# Each worker writes a single tab-separated record to a temp file:
#   name<TAB>url<TAB>status<TAB>sha<TAB>hostname<TAB>uptime_s<TAB>ha<TAB>home_id<TAB>last_deploy_ts
# status is "ok" or "offline". Missing fields are written as the literal "-".
# ----------------------------------------------------------------------------
TMPDIR="$(mktemp -d -t ziggy-fleet.XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

probe_home() {
  local name="$1"
  local url="$2"
  local out="$3"
  local raw_dir="$4"

  local version_json deploy_json
  version_json="$(curl -fsS --max-time 5 "${url%/}/api/version" 2>/dev/null || true)"
  deploy_json="$(curl -fsS --max-time 5 "${url%/}/api/__deploy__?limit=3" 2>/dev/null || true)"

  # Persist raw bodies for -v mode.
  printf '%s' "$version_json" > "${raw_dir}/${name}.version.json"
  printf '%s' "$deploy_json"  > "${raw_dir}/${name}.deploy.json"

  if [[ -z "$version_json" ]]; then
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$name" "$url" "offline" "-" "-" "-" "-" "-" "-" >> "$out"
    return 0
  fi

  # One python pass parses both blobs and emits the row fields tab-separated.
  python3 - "$name" "$url" "$version_json" "$deploy_json" <<'PY' >> "$out"
import json, sys
name, url, vraw, draw = sys.argv[1:5]

def field(d, k, default="-"):
    v = d.get(k) if isinstance(d, dict) else None
    if v is None or v == "":
        return default
    return v

try:
    v = json.loads(vraw) if vraw else {}
except Exception:
    v = {}
try:
    d = json.loads(draw) if draw else {}
except Exception:
    d = {}

sha       = field(v, "git_sha")
hostname  = field(v, "hostname")
uptime    = field(v, "uptime_s")
ha        = field(v, "ha_configured")
home_id   = field(v, "home_id")

last_ts = "-"
entries = d.get("entries") if isinstance(d, dict) else None
if isinstance(entries, list) and entries:
    first = entries[0]
    if isinstance(first, dict):
        last_ts = first.get("ts") or "-"

status = "ok" if sha != "-" else "offline"

# Coerce booleans/numbers to strings for the tsv.
def s(x):
    if isinstance(x, bool):
        return "true" if x else "false"
    return str(x)

print("\t".join([name, url, status, s(sha), s(hostname), s(uptime), s(ha), s(home_id), s(last_ts)]))
PY
}

for i in "${!NAMES[@]}"; do
  probe_home "${NAMES[$i]}" "${URLS[$i]}" "${TMPDIR}/rows.tsv" "${TMPDIR}" &
done
wait

# ----------------------------------------------------------------------------
# Aggregate, sort, and pick a reference SHA (the SHA most homes agree on, or
# just the only one if there's a single responding home).
# ----------------------------------------------------------------------------
ROWS_FILE="${TMPDIR}/rows.tsv"
if [[ ! -s "$ROWS_FILE" ]]; then
  echo "ERROR: no rows collected from any home."
  exit 1
fi

# Sort by name so output is stable run-to-run.
sort -t $'\t' -k1,1 "$ROWS_FILE" -o "$ROWS_FILE"

# Reference SHA: pick the SHA shared by the most responding homes.
REFERENCE_SHA="$(
  awk -F'\t' '$3 == "ok" { print $4 }' "$ROWS_FILE" \
    | sort | uniq -c | sort -rn | awk 'NR==1 { print $2 }'
)"
REFERENCE_SHA="${REFERENCE_SHA:-}"

TOTAL_HOMES="${#NAMES[@]}"
RESPONDING="$(awk -F'\t' '$3 == "ok"' "$ROWS_FILE" | wc -l | tr -d ' ')"
UP_TO_DATE=0
if [[ -n "$REFERENCE_SHA" ]]; then
  UP_TO_DATE="$(awk -F'\t' -v ref="$REFERENCE_SHA" '$3 == "ok" && $4 == ref' "$ROWS_FILE" | wc -l | tr -d ' ')"
fi

# Only color when we have more than one home AND we have a reference SHA.
USE_COLOR=0
if [[ "$TOTAL_HOMES" -gt 1 && -n "$REFERENCE_SHA" && -t 1 ]]; then
  USE_COLOR=1
fi

red() { if [[ "$USE_COLOR" -eq 1 ]]; then printf '\033[31m%s\033[0m' "$1"; else printf '%s' "$1"; fi; }
dim() { if [[ "$USE_COLOR" -eq 1 ]]; then printf '\033[2m%s\033[0m'  "$1"; else printf '%s' "$1"; fi; }

# ----------------------------------------------------------------------------
# Human-friendly uptime formatter. Input is an integer seconds string or "-".
# Output examples: "45s", "12m", "2h 14m", "3d 5h".
# ----------------------------------------------------------------------------
format_uptime() {
  local s="$1"
  if [[ "$s" == "-" || -z "$s" ]]; then
    printf '%s' "-"
    return
  fi
  # Strip any decimal portion (some servers return floats).
  s="${s%.*}"
  if ! [[ "$s" =~ ^[0-9]+$ ]]; then
    printf '%s' "-"
    return
  fi
  local days=$(( s / 86400 ))
  local hours=$(( (s % 86400) / 3600 ))
  local mins=$(( (s % 3600) / 60 ))
  local secs=$(( s % 60 ))
  if (( days > 0 )); then
    printf '%dd %dh' "$days" "$hours"
  elif (( hours > 0 )); then
    printf '%dh %dm' "$hours" "$mins"
  elif (( mins > 0 )); then
    printf '%dm' "$mins"
  else
    printf '%ds' "$secs"
  fi
}

# ----------------------------------------------------------------------------
# Render the table. Use printf with fixed-width columns. ASCII only.
# ----------------------------------------------------------------------------
FMT='%-26s  %-22s  %-14s  %-10s  %-10s  %-3s  %s\n'
printf "$FMT" "NAME" "HOME_ID" "HOSTNAME" "SHA" "UPTIME" "HA" "LAST_DEPLOY_TS"
printf "$FMT" "----" "-------" "--------" "---" "------" "--" "--------------"

while IFS=$'\t' read -r name url status sha hostname uptime_s ha home_id last_ts; do
  if [[ "$status" == "offline" ]]; then
    sha_disp="OFFLINE"
    uptime_disp="-"
    ha_disp="-"
    hostname_disp="-"
    home_id_disp="-"
    last_disp="-"
  else
    sha_disp="${sha:0:8}"
    uptime_disp="$(format_uptime "$uptime_s")"
    case "$ha" in
      true|True|TRUE|1|yes) ha_disp="yes" ;;
      false|False|FALSE|0|no) ha_disp="no" ;;
      *) ha_disp="-" ;;
    esac
    hostname_disp="$hostname"
    home_id_disp="$home_id"
    last_disp="$last_ts"
  fi

  drift=0
  if [[ -n "$REFERENCE_SHA" && "$status" == "ok" && "$sha" != "$REFERENCE_SHA" ]]; then
    drift=1
  fi
  if [[ "$status" == "offline" ]]; then
    drift=1
  fi

  if [[ "$drift" -eq 1 && "$TOTAL_HOMES" -gt 1 ]]; then
    # Render whole row in red so drift is visible at a glance.
    line="$(printf "$FMT" "$name" "$home_id_disp" "$hostname_disp" "$sha_disp" "$uptime_disp" "$ha_disp" "$last_disp")"
    red "$line"
  else
    printf "$FMT" "$name" "$home_id_disp" "$hostname_disp" "$sha_disp" "$uptime_disp" "$ha_disp" "$last_disp"
  fi
done < "$ROWS_FILE"

echo
ref_short="${REFERENCE_SHA:0:8}"
if [[ -z "$REFERENCE_SHA" ]]; then
  echo "${RESPONDING}/${TOTAL_HOMES} homes responding, 0 up-to-date (no responding homes)"
else
  echo "${RESPONDING}/${TOTAL_HOMES} homes responding, ${UP_TO_DATE} up-to-date at ${ref_short}"
fi

# ----------------------------------------------------------------------------
# Verbose mode: dump raw JSON beneath the table for debugging.
# ----------------------------------------------------------------------------
if [[ "$VERBOSE" -eq 1 ]]; then
  echo
  echo "---- raw responses ----"
  for n in "${NAMES[@]}"; do
    echo
    echo "[$n] /api/version:"
    if [[ -s "${TMPDIR}/${n}.version.json" ]]; then
      cat "${TMPDIR}/${n}.version.json"
    else
      echo "(no response)"
    fi
    echo
    echo "[$n] /api/__deploy__?limit=3:"
    if [[ -s "${TMPDIR}/${n}.deploy.json" ]]; then
      cat "${TMPDIR}/${n}.deploy.json"
    else
      echo "(no response)"
    fi
    echo
  done
fi

# ----------------------------------------------------------------------------
# Exit code: 0 iff every home responded AND they all share the same SHA.
# ----------------------------------------------------------------------------
if [[ "$RESPONDING" -eq "$TOTAL_HOMES" && "$UP_TO_DATE" -eq "$TOTAL_HOMES" && -n "$REFERENCE_SHA" ]]; then
  exit 0
fi
exit 1
