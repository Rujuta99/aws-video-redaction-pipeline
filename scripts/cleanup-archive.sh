#!/usr/bin/env bash
set -euo pipefail

BUCKET_NAME="${BUCKET_NAME:-social-media-uploads-rujuta}"
TARGET_PREFIX="${TARGET_PREFIX:-video-transcription/archive-3tb/}"

printf "This will delete s3://%s/%s\n" "$BUCKET_NAME" "$TARGET_PREFIX"
read -r -p "Type DELETE to continue: " confirm
if [[ "$confirm" != "DELETE" ]]; then
  echo "Cancelled."
  exit 1
fi

aws s3 rm "s3://${BUCKET_NAME}/${TARGET_PREFIX}" --recursive
