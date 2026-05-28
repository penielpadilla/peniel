export interface Lead {
  id?: string;
  nombre: string;
  empresa: string;
  puesto: string;
  correo: string;
  telefono: string;
  ubicacion: string;
  unidad: string;
  proyecto: string;
  comentarios: string;
  intereses: string[];
  fecha?: string;
  dispositivo?: string;
  registradoPor?: string;
  syncStatus?: 'synced' | 'offline_pending';
  syncedAt?: string;
}

export interface NotificationState {
  type: 'success' | 'error' | 'info';
  text: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface MockCard {
  label: string;
  nombre: string;
  empresa: string;
  puesto: string;
  correo: string;
  telefono: string;
  ubicacion: string;
  unidad: string;
  proyecto: string;
  comentarios: string;
}

declare global {
  interface Window {
    __app_id?: string;
    __firebase_config?: string;
    __initial_auth_token?: string;
  }
}
