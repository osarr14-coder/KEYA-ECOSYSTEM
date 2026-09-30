#!/usr/bin/env python3
"""T15 (CDC §10, PO-2026-09-29-13) — vérification PAR L'API de l'analyse des
dépôts sur un environnement déployé (Render ou local). Voir
docs/exploitation/PROCEDURE_VERIFICATION_RENDER_T15_T16.md.

Bibliothèque standard seulement : se lance depuis le poste de l'exploitant.

    DEMO_PASSWORD=… python3 scripts/verify_upload_scan_api.py \
        --api https://keya-ecosystem-backend.onrender.com

Le mot de passe des comptes de démonstration est lu dans DEMO_PASSWORD,
jamais affiché ni écrit. Aucun jeton n'est affiché.

Mode normal (moteur antivirus en service) :
  - PDF sain → 201 (un document de démonstration est créé) ;
  - PDF avec JavaScript, PDF chiffré, PDF portant le fichier de test EICAR
    → 400, message attendu, rien d'enregistré ;
  - journal de l'administrateur : un refus « Dépôt refusé à l'analyse » de
    plus par dépôt refusé.
Mode --moteur-arrete (moteur antivirus suspendu par l'exploitant) :
  - PDF sain → 503 « Analyse des fichiers momentanément indisponible ».
Code de sortie 0 si tout est conforme, 1 sinon.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

# Fichier de test antivirus standard (EICAR), reconstitué pour ne pas figurer
# tel quel dans le dépôt de code.
EICAR = ('X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-' + 'TEST-FILE!$H+H*').encode()

ACTIVE = 'Fichier refusé : ce PDF contient du contenu actif'
ENCRYPTED = 'Fichier refusé : PDF chiffré ou protégé'
VIRUS = 'Fichier refusé : l’analyse a détecté un contenu dangereux'
UNAVAILABLE = 'Analyse des fichiers momentanément indisponible'
REJECTION_ACTION = 'document.upload_rejected'
LOGIN_SPACING_SECONDS = 13  # limite de débit de la connexion


def _pdf(*objects, trailer=b''):
    body = b'%PDF-1.7\n'
    for number, content in enumerate(objects, start=1):
        body += b'%d 0 obj\n' % number + content + b'\nendobj\n'
    return body + b'trailer\n<< /Root 1 0 R ' + trailer + b'>>\n%%EOF\n'


CLEAN = _pdf(b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [] /Count 0 >>')
JAVASCRIPT = _pdf(b'<< /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>')
ENCRYPTED_PDF = _pdf(b'<< /Type /Catalog >>', b'<< /Filter /Standard /V 2 >>', trailer=b'/Encrypt 2 0 R ')
EICAR_PDF = b'%PDF-1.4\n%' + EICAR + b'\n%%EOF\n'


class Api:
    def __init__(self, base):
        self.base = base.rstrip('/')
        self._last_login = 0.0

    def call(self, method, path, token=None, body=None, raw=None, content_type=None):
        headers = {'Accept': 'application/json'}
        data = None
        if raw is not None:
            data, headers['Content-Type'] = raw, content_type
        elif body is not None:
            data, headers['Content-Type'] = json.dumps(body).encode(), 'application/json'
        if token:
            headers['Authorization'] = f'Bearer {token}'
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                status, text = response.status, response.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as error:
            status, text = error.code, error.read().decode('utf-8', 'replace')
        try:
            return status, json.loads(text) if text else None
        except ValueError:
            return status, text[:300]

    def login(self, email, password):
        wait = LOGIN_SPACING_SECONDS - (time.time() - self._last_login)
        if wait > 0:
            time.sleep(wait)
        self._last_login = time.time()
        status, body = self.call('POST', '/api/auth/login/', body={'email': email, 'password': password})
        if status != 200:
            sys.exit(f'Connexion refusée pour {email} ({status}) : vérifier DEMO_PASSWORD et le compte.')
        return body['access']

    def upload(self, token, content):
        boundary = uuid.uuid4().hex
        parts = [('category', b'verification_t15'), ('source', b'verification_render')]
        raw = b''
        for name, value in parts:
            raw += f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'.encode() + value + b'\r\n'
        raw += (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="plan.pdf"\r\n'
            'Content-Type: application/pdf\r\n\r\n'
        ).encode() + content + f'\r\n--{boundary}--\r\n'.encode()
        return self.call('POST', '/api/documents/', token, raw=raw, content_type=f'multipart/form-data; boundary={boundary}')

    def journal(self, token):
        """Derniers événements du journal (fenêtre limitée par organisation) ;
        les identifiants sont croissants dans l'ordre d'inscription."""
        status, body = self.call('GET', '/api/admin/journal/', token)
        if status != 200:
            sys.exit(f'Journal de l’administrateur illisible ({status}).')
        return body.get('results', body) if isinstance(body, dict) else body


def _message(body):
    if isinstance(body, dict):
        value = body.get('detail') or body.get('file') or body
        return ' '.join(value) if isinstance(value, list) else str(value)
    return str(body)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--api', required=True, help='URL du backend, ex. https://keya-ecosystem-backend.onrender.com')
    parser.add_argument('--constructeur', default='constructeur.demo@keya.test')
    parser.add_argument('--admin', default='admin.demo@keya.test')
    parser.add_argument('--moteur-arrete', action='store_true', help='le moteur antivirus a été suspendu : attendre 503')
    args = parser.parse_args()
    password = os.environ.get('DEMO_PASSWORD')
    if not password:
        sys.exit('DEMO_PASSWORD absent de l’environnement.')

    api = Api(args.api)
    builder = api.login(args.constructeur, password)
    results = []

    def check(label, status, body, expected_status, expected_text=None):
        ok = status == expected_status and (expected_text is None or expected_text in _message(body))
        results.append(ok)
        shown = '' if status == 201 else ' — ' + _message(body)[:110]
        print(f'{"CONFORME" if ok else "ÉCART   "}  {label} : {status} (attendu {expected_status}){shown}')

    if args.moteur_arrete:
        status, body = api.upload(builder, CLEAN)
        check('PDF sain, moteur arrêté', status, body, 503, UNAVAILABLE)
    else:
        admin = api.login(args.admin, password)
        last_id = max((item['id'] for item in api.journal(admin)), default=0)
        status, body = api.upload(builder, CLEAN)
        check('PDF sain (contrôle positif)', status, body, 201)
        for label, content, text in (
            ('PDF avec JavaScript', JAVASCRIPT, ACTIVE),
            ('PDF chiffré', ENCRYPTED_PDF, ENCRYPTED),
            ('PDF portant le fichier de test EICAR (antivirus)', EICAR_PDF, VIRUS),
        ):
            status, body = api.upload(builder, content)
            check(label, status, body, 400, text)
        added = sum(1 for item in api.journal(admin) if item['id'] > last_id and item.get('action') == REJECTION_ACTION)
        ok = added == 3
        results.append(ok)
        print(f'{"CONFORME" if ok else "ÉCART   "}  journal de l’administrateur : {added} refus « Dépôt refusé à l’analyse » ajouté(s) (attendu 3)')

    print(f'\n{sum(results)}/{len(results)} conforme(s).')
    return 0 if all(results) else 1


if __name__ == '__main__':
    sys.exit(main())
