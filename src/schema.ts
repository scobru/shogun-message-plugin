/**
 * Schema per il plugin di messaggistica Shogun
 * Definisce tutti i percorsi GunDB in modo centralizzato per consistenza
 */

export const MessagingSchema = {
  // Percorsi principali
  root: 'shogun',
  collections: {
    messages: 'messages',
    groups: 'groups',
    tokenRooms: 'tokenRooms',
    publicRooms: 'publicRooms',
    users: 'users',
    conversations: 'conversations',
    usernames: 'usernames' // **NEW: Username mapping collection**
  },

  // Percorsi per messaggi privati
  privateMessages: {
    // Percorso per messaggi inviati a un destinatario specifico
    recipient: (recipientPub: string) => `msg_${recipientPub}`,
    
    // Percorso per messaggi ricevuti dall'utente corrente
    currentUser: (currentUserPub: string) => `msg_${currentUserPub}`,
    
    // Percorso conversazione bidirezionale
    conversation: (user1Pub: string, user2Pub: string) => {
      const sorted = [user1Pub, user2Pub].sort();
      return `conversation_${sorted[0]}_${sorted[1]}`;
    },
    
    // Percorso legacy per compatibilità
    legacy: {
      userMessages: (userPub: string) => `${userPub}/messages`,
      userMessagesByDate: (userPub: string, date: string) => `${userPub}/messages/${date}`,
      messageById: (userPub: string, date: string, messageId: string) => 
        `${userPub}/messages/${date}/${messageId}`
    }
  },

  // Percorsi per gruppi
  groups: {
    // Dati del gruppo
    data: (groupId: string) => `group_${groupId}`,
    
    // Messaggi del gruppo
    messages: (groupId: string) => `group-messages/${groupId}`,
    
    // Membri del gruppo
    members: (groupId: string) => `group_${groupId}/members`,
    
    // Chiavi cifrate del gruppo
    encryptedKeys: (groupId: string) => `group_${groupId}/encryptedKeys`,
    
    // **NEW: localStorage keys for groups**
    localStorage: (groupId: string) => `group_messages_${groupId}`
  },

  // Percorsi per stanze token
  tokenRooms: {
    // Dati della stanza
    data: (roomId: string) => `token_room_${roomId}`,
    
    // Messaggi della stanza
    messages: (roomId: string) => `token-messages/${roomId}`,
    
    // Membri della stanza
    members: (roomId: string) => `token_room_${roomId}/members`,
    
    // Token di accesso
    access: (roomId: string) => `token_room_${roomId}/access`,
    
    // **NEW: localStorage keys for token rooms**
    localStorage: (roomId: string) => `tokenRoom_messages_${roomId}`
  },

  // Percorsi per stanze pubbliche
  publicRooms: {
    // Dati della stanza
    data: (roomId: string) => `public_room_${roomId}`,
    
    // Messaggi della stanza
    messages: (roomId: string) => `public-messages/${roomId}`,
    
    // Metadati della stanza
    metadata: (roomId: string) => `public_room_${roomId}/metadata`,
    
    // **NEW: localStorage keys for public rooms**
    localStorage: (roomId: string) => `publicRoom_messages_${roomId}`
  },

  // Percorsi per utenti
  users: {
    // Profilo utente
    profile: (userPub: string) => `~${userPub}`,
    
    // Dati utente
    data: (userPub: string) => `users/${userPub}`,
    
    // Chiavi di cifratura
    epub: (userPub: string) => `~${userPub}/epub`,
    
    // Gruppi dell'utente
    groups: (userPub: string) => `users/${userPub}/groups`,
    
    // Stanze token dell'utente
    tokenRooms: (userPub: string) => `users/${userPub}/tokenRooms`,
    
    // **NEW: Username mapping per ricerca utenti**
    usernames: () => `usernames`,
    
    // **NEW: Mapping username -> user data**
    usernameMapping: (username: string) => `usernames/${username}`,
    
    // **NEW: Test path per connessione GunDB**
    test: () => `test`
  },

  // Percorsi per conversazioni
  conversations: {
    // Conversazione specifica
    conversation: (conversationId: string) => `conversations/${conversationId}`,
    
    // Messaggi di una conversazione
    messages: (conversationId: string) => `conversations/${conversationId}/messages`,
    
    // Metadati conversazione
    metadata: (conversationId: string) => `conversations/${conversationId}/metadata`
  },

  // Utility per generare ID e percorsi
  utils: {
    // Genera ID messaggio unico
    generateMessageId: () => `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    
    // Genera ID gruppo unico
    generateGroupId: () => `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    
    // Genera ID stanza token unico
    generateTokenRoomId: () => `token_room_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    
    // Genera ID stanza pubblica unico
    generatePublicRoomId: () => `public_room_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    
    // Formato data per organizzazione messaggi (YYYY-MM-DD)
    formatDate: (date: Date = new Date()) => date.toLocaleDateString("en-CA"),
    
    // Formato data per timestamp
    formatTimestamp: (timestamp: number) => new Date(timestamp).toLocaleDateString("en-CA"),
    
    // Crea ID conversazione consistente
    createConversationId: (user1Pub: string, user2Pub: string) => {
      const sorted = [user1Pub, user2Pub].sort();
      return `conversation_${sorted[0]}_${sorted[1]}`;
    }
  },

  // Percorsi per debug e sviluppo
  debug: {
    // Struttura GunDB per debug
    structure: (path: string) => `debug/${path}`,
    
    // Log operazioni
    logs: (operation: string) => `debug/logs/${operation}`,
    
    // Metriche performance
    metrics: (component: string) => `debug/metrics/${component}`
  }
};

/**
 * Helper per creare percorsi sicuri
 */
export function createSafePath(pubKey: string, prefix: string = "msg"): string {
  if (!pubKey || typeof pubKey !== "string") {
    throw new Error("Public key deve essere una stringa valida");
  }
  
  // Rimuovi caratteri pericolosi e normalizza
  const safeKey = pubKey.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${prefix}_${safeKey}`;
}

/**
 * Helper per creare percorsi conversazione
 */
export function createConversationPath(user1Pub: string, user2Pub: string): string {
  if (!user1Pub || !user2Pub) {
    throw new Error("Entrambe le public key sono richieste");
  }
  
  return MessagingSchema.utils.createConversationId(user1Pub, user2Pub);
}

/**
 * Helper per validare percorsi
 */
export function validatePath(path: string): boolean {
  if (!path || typeof path !== "string") {
    return false;
  }
  
  // Controlla caratteri pericolosi
  const dangerousChars = /[<>:"|?*]/;
  return !dangerousChars.test(path);
}

/**
 * Helper per normalizzare percorsi
 */
export function normalizePath(path: string): string {
  if (!path) return "";
  
  // Rimuovi caratteri pericolosi e normalizza separatori
  return path
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}
