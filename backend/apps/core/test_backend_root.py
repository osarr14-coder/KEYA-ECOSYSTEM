"""Ticket B-055 — racine du backend."""
from django.test import Client, override_settings


@override_settings(WEB_APP_URL='https://keya-ecosystem-web.onrender.com')
def test_root_redirects_to_the_web_application():
    response = Client().get('/')
    assert response.status_code == 302
    assert response['Location'] == 'https://keya-ecosystem-web.onrender.com'


@override_settings(WEB_APP_URL='')
def test_root_without_configuration_says_it_is_the_api():
    response = Client().get('/')
    assert response.status_code == 200
    assert response.json()['service'] == 'API KEYA ECOSYSTEM'
