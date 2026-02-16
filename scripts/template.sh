#!/usr/bin/env sh
set -eu

cmd="${1:-}"
shift || true

case "$cmd" in
	status)
		git -C vendor/pluxel-template status -sb
		;;
	pull)
		git -C vendor/pluxel-template pull --ff-only
		;;
	update)
		git submodule update --remote --merge vendor/pluxel-template
		;;
	*)
		echo "Usage: scripts/template.sh <status|pull|update>" >&2
		exit 2
		;;
esac

