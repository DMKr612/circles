#!/usr/bin/env bash
set -euo pipefail

if ! command -v supabase >/dev/null 2>&1; then
  echo "Error: supabase CLI is required." >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required." >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required." >&2
  exit 1
fi

PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
if [[ -z "$PROJECT_REF" && -f "supabase/.temp/project-ref" ]]; then
  PROJECT_REF="$(cat supabase/.temp/project-ref)"
fi
if [[ -z "$PROJECT_REF" ]]; then
  echo "Error: Could not resolve project ref. Set SUPABASE_PROJECT_REF." >&2
  exit 1
fi

SUPABASE_URL="${SUPABASE_URL_OVERRIDE:-}"
if [[ -z "$SUPABASE_URL" && -f ".env.local" ]]; then
  SUPABASE_URL="$(awk -F= '/^VITE_SUPABASE_URL=/{print $2}' .env.local | tail -n 1)"
fi
if [[ -z "$SUPABASE_URL" ]]; then
  read -r -p "Supabase URL (https://<project-ref>.supabase.co): " SUPABASE_URL
fi
SUPABASE_URL="${SUPABASE_URL%/}"

AUTO_YES=0
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y)
      AUTO_YES=1
      shift
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

USER_IDS=()
if [[ ${#ARGS[@]} -gt 0 ]]; then
  for arg in "${ARGS[@]}"; do
    CLEAN="$(echo "$arg" | tr -d '[:space:]')"
    [[ -z "$CLEAN" ]] && continue
    USER_IDS+=("$CLEAN")
  done
else
  read -r -p "User UUID to permanently delete: " USER_ID
  USER_ID="$(echo "$USER_ID" | tr -d '[:space:]')"
  USER_IDS+=("$USER_ID")
fi

if [[ ${#USER_IDS[@]} -eq 0 ]]; then
  echo "Error: no user UUIDs provided." >&2
  exit 1
fi

for USER_ID in "${USER_IDS[@]}"; do
  if ! [[ "$USER_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]]; then
    echo "Error: invalid UUID format: $USER_ID" >&2
    exit 1
  fi
done

echo
echo "WARNING: This will permanently delete ${#USER_IDS[@]} user(s) and all related data."
printf 'Targets:\n'
for USER_ID in "${USER_IDS[@]}"; do
  echo "  - $USER_ID"
done
if [[ "$AUTO_YES" -ne 1 ]]; then
  read -r -p "Type DELETE to continue: " CONFIRM
  if [[ "$CONFIRM" != "DELETE" ]]; then
    echo "Cancelled."
    exit 1
  fi
fi

SERVICE_ROLE_KEY="$(supabase projects api-keys --project-ref "$PROJECT_REF" -o json | jq -r '.[] | select(.name=="service_role") | .api_key')"
if [[ -z "$SERVICE_ROLE_KEY" || "$SERVICE_ROLE_KEY" == "null" ]]; then
  echo "Error: could not fetch service_role key for project $PROJECT_REF." >&2
  exit 1
fi

SUCCESS_COUNT=0
FAIL_COUNT=0

for USER_ID in "${USER_IDS[@]}"; do
  REQUEST_BODY="$(jq -nc --arg user_id "$USER_ID" '{user_id:$user_id,confirm:true}')"
  RESPONSE="$(curl -sS -w $'\n%{http_code}' \
    -X POST "$SUPABASE_URL/functions/v1/admin-delete-user" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "$REQUEST_BODY")"

  HTTP_CODE="$(echo "$RESPONSE" | tail -n1)"
  BODY="$(echo "$RESPONSE" | sed '$d')"

  echo
  echo "User: $USER_ID"
  echo "HTTP $HTTP_CODE"
  if echo "$BODY" | jq . >/dev/null 2>&1; then
    echo "$BODY" | jq .
  else
    echo "$BODY"
  fi

  if [[ "$HTTP_CODE" == "200" ]]; then
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

echo
echo "Done. success=$SUCCESS_COUNT failed=$FAIL_COUNT"
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
