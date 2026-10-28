#!/usr/bin/env bash
# Arma el zip para la Chrome Web Store: solo lo que carga la extensión (sin tests, documentos ni .claude).
set -euo pipefail
cd "$(dirname "$0")"

version=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
salida="dist/traductor-ia-$version.zip"

mkdir -p dist
rm -f "$salida"
zip -qr "$salida" manifest.json ./*.js ./*.html ./*.css _locales icons fonts
echo "$salida"
