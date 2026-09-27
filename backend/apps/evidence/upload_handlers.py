from django.core.files.uploadhandler import FileUploadHandler, SkipFile

from .validators import MAX_UPLOAD_SIZE_BYTES


class MaxSizeUploadHandler(FileUploadHandler):
    """Ticket B-047 — premier de `FILE_UPLOAD_HANDLERS` (config/settings.py).
    Sans lui, Django écrit l'intégralité d'un envoi de plusieurs Go dans un
    fichier temporaire AVANT que le validateur ne puisse le rejeter
    (`DATA_UPLOAD_MAX_MEMORY_SIZE` ne couvre pas les fichiers). `SkipFile` :
    Django lit et jette le reste du fichier, jamais écrit sur disque, et
    ferme les fichiers temporaires déjà ouverts par les gestionnaires
    suivants.
    """

    def receive_data_chunk(self, raw_data, start):
        if start + len(raw_data) > MAX_UPLOAD_SIZE_BYTES:
            if self.request is not None:
                self.request.upload_too_large = True
            raise SkipFile()
        return raw_data

    def file_complete(self, file_size):
        return None
