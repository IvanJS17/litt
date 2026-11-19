#!/usr/bin/env bash
# LiTT — tamaño en disco de un release, para el chequeo de espacio de litt-deploy.sh
# (HOST-RULES §5: libres >= max(7 GiB, 2 × tamaño + 5 GiB)).
#
# Uso: bash deploy/prod/image-bytes.sh "$SHA"   → imprime los bytes.
#
# El VPS usa el almacén de imágenes de containerd: por cada capa guarda el contenido
# descomprimido y además el blob comprimido. Las tres imágenes comparten la base
# node:22-slim. Por eso el tamaño es la suma, contando cada capa una sola vez, de:
#   1. las capas descomprimidas (`docker history`), y
#   2. los blobs comprimidos (`docker save`).
# Falla (sin imprimir nada) si falta alguna imagen o si un paso falla.
set -euo pipefail

SHA=${1:?uso: image-bytes.sh SHA}
IMAGES=("litt-backend:$SHA" "litt-frontend:$SHA" "litt-word:$SHA")
for image in "${IMAGES[@]}"; do
  docker image inspect "$image" > /dev/null
done

# 1. Capas descomprimidas, una vez cada una. Una capa compartida tiene la misma fecha,
#    instrucción y tamaño en las tres imágenes.
unpacked=$(for image in "${IMAGES[@]}"; do
  docker history --no-trunc --human=false --format '{{.CreatedAt}}|{{.CreatedBy}}|{{.Size}}' "$image"
done | sort -u | awk -F'|' '{ s += $NF } END { printf "%d", s }')

# 2. Blobs comprimidos, una vez cada uno (el nombre es su digest).
packed=$(docker save "${IMAGES[@]}" | tar -tvf - \
  | awk '$NF ~ /^blobs\/sha256\// { print $NF, $3 }' | sort -u \
  | awk '{ s += $2 } END { printf "%d", s }')

[ "$unpacked" -gt 0 ] && [ "$packed" -gt 0 ]
echo $((unpacked + packed))
