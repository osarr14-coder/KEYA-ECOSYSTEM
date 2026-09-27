/**
 * Audit UI R1 (K04, PO-2026-09-27-04) — mode hors ligne DÉSACTIVÉ pour le
 * MVP : la date serveur fait foi. Le code hors ligne (brouillons IndexedDB,
 * moteur de synchronisation, `InspectionFormView`) est conservé, mais n'est
 * plus démarré ni affiché tant que ce drapeau est faux.
 */
export const OFFLINE_MODE_ENABLED = false;
