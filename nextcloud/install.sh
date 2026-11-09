#!/bin/bash
# Builds the winlab_viewer Nextcloud app and installs it on the WinLab
# Nextcloud (k8s, namespace nextcloud). Build where Node is (npm ci && npm
# run build), then run this with kubectl and the winfra kubeconfig
# (KUBECONFIG).
set -euo pipefail
cd "$(dirname "$0")"
test -f winlab_viewer/js/winlab_viewer-main.js || {
  echo "build first: npm ci && npm run build" >&2
  exit 1
}
pod=$(kubectl -n nextcloud get pod -l app.kubernetes.io/component=app \
  -o jsonpath='{.items[0].metadata.name}')
COPYFILE_DISABLE=1 tar -C . --no-xattrs --exclude=src -cf - winlab_viewer |
  kubectl -n nextcloud exec -i "$pod" -c nextcloud -- \
    tar -C /var/www/html/custom_apps --no-same-owner -xf -
kubectl -n nextcloud exec "$pod" -c nextcloud -- sh -c \
  'chown -R www-data:www-data /var/www/html/custom_apps/winlab_viewer &&
   su -s /bin/sh www-data -c "php occ app:enable winlab_viewer"'
