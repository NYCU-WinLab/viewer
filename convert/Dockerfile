# Gotenberg (LibreOffice behind an HTTP API) with the fonts lab documents
# use, or ones with the same widths, so pages break where they did in Word
# and PowerPoint.
FROM gotenberg/gotenberg:8
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation2 \
      fonts-noto-cjk fonts-arphic-ukai fonts-arphic-uming \
 && rm -rf /var/lib/apt/lists/*
COPY fonts.conf /etc/fonts/conf.d/99-viewer-aliases.conf
RUN fc-cache -f
USER gotenberg
