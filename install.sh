#!/bin/sh
# Install a verified release without modifying shell profiles or application state.
set -eu
fail() { printf 'compositor: %s\n' "$*" >&2; exit 1; }
version=latest
prefix=${COMPOSITOR_INSTALL_PREFIX:-"$HOME/.local"}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) [ "$#" -ge 2 ] || fail '--version needs a tag'; version=$2; shift 2 ;;
    --prefix) [ "$#" -ge 2 ] || fail '--prefix needs a directory'; prefix=$2; shift 2 ;;
    --help|-h) printf 'Usage: install.sh [--version vX.Y.Z] [--prefix DIR]\nDefault prefix: $HOME/.local\n'; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done
case "$version" in latest|v[0-9]*) ;; *) fail 'Expected a release tag such as v0.1.0';; esac
case "$version" in *[!a-zA-Z0-9._-]*) fail 'Invalid version';; esac
case "$prefix" in /*) ;; *) fail '--prefix must be absolute';; esac
case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) fail 'Supported systems: Linux and macOS';; esac
case "$(uname -m)" in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) fail 'Supported architectures: x64 and arm64';; esac
for command in curl tar awk mktemp; do command -v "$command" >/dev/null 2>&1 || fail "Missing command: $command"; done
if command -v sha256sum >/dev/null 2>&1; then checksum() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then checksum() { shasum -a 256 "$1" | awk '{print $1}'; }
else fail 'Install sha256sum or shasum'; fi
base=${COMPOSITOR_RELEASE_BASE_URL:-https://github.com/Neko1313/agent-compositor/releases}
if [ "$version" = latest ]; then url=$base/latest/download; else url=$base/download/$version; fi
asset=compositor-$os-$arch.tar.gz
tmp=$(mktemp -d)
stage=
trap 'rm -rf "$tmp"; if [ -n "$stage" ]; then rm -rf "$stage"; fi' EXIT
trap 'exit 1' HUP INT TERM
curl -fLSs --retry 3 "$url/$asset" -o "$tmp/$asset"
curl -fLSs --retry 3 "$url/SHA256SUMS" -o "$tmp/SHA256SUMS"
expected=$(awk -v asset="$asset" '$2 == asset { print $1 }' "$tmp/SHA256SUMS")
[ "${#expected}" -eq 64 ] || fail 'Missing or ambiguous checksum'
[ "$(checksum "$tmp/$asset")" = "$expected" ] || fail 'Checksum mismatch; refusing installation'
# Only the release directory may be extracted. Official archives contain no links.
tar -tzf "$tmp/$asset" > "$tmp/entries"
awk '/^\// || /(^|\/)\.\.($|\/)/ || $0 !~ /^compositor(\/|$)/ { bad=1 } END { exit bad }' "$tmp/entries" || fail 'Invalid archive paths'
tar -tvzf "$tmp/$asset" | awk 'substr($0,1,1) != "d" && substr($0,1,1) != "-" { bad=1 } END { exit bad }' || fail 'Unexpected archive links'
if [ -e "$prefix/bin/compositor" ] && [ ! -L "$prefix/bin/compositor" ]; then fail "$prefix/bin/compositor already exists and is not a symlink"; fi
mkdir -p "$prefix/share/agent-compositor" "$prefix/bin"
stage=$(mktemp -d "$prefix/share/agent-compositor/.install.XXXXXXXX")
tar -xzf "$tmp/$asset" -C "$stage"
installed=$(cat "$stage/compositor/VERSION")
case "$installed" in v[0-9]*) ;; *) fail 'Invalid release metadata';; esac
case "$installed" in *[!a-zA-Z0-9._-]*) fail 'Invalid release metadata';; esac
[ "$version" = latest ] || [ "$installed" = "$version" ] || fail 'Archive version does not match requested version'
[ "$("$stage/compositor/compositor" --version)" = "compositor ${installed#v}" ] || fail 'Binary verification failed'
# Every install gets its own directory; updates never overwrite a running version.
destination=$prefix/share/agent-compositor/$installed-$os-$arch-$(basename "$stage")
mv "$stage/compositor" "$destination"
link=$stage/compositor-link
ln -s "$destination/compositor" "$link"
mv -f "$link" "$prefix/bin/compositor"
printf 'Installed compositor %s to %s/bin/compositor\n' "${installed#v}" "$prefix"
case ":${PATH:-}:" in *":$prefix/bin:"*) ;; *) printf 'Add to your shell profile: export PATH="%s/bin:$PATH"\n' "$prefix";; esac
