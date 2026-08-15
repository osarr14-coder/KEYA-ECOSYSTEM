from rest_framework.pagination import PageNumberPagination


class LotPagination(PageNumberPagination):
    """Pagination dédiée à `AllLotsView` — volontairement PAS la pagination
    par défaut du projet (`REST_FRAMEWORK` reste sans pagination globale
    dans `config/settings.py`, pour ne rien changer au comportement des
    endpoints existants comme `LotViewSet`, qui renvoient toujours un
    tableau brut). Nécessaire ici pour que le critère d'acceptation
    « reste utilisable au-delà de 200 lignes » (ticket 009) tienne : la
    page transférée au client reste petite, indépendamment du nombre total
    de lots de l'organisation.
    """

    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100
