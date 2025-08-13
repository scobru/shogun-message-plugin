# Token Rooms - Nuovo Flusso Ordinato

## **PROBLEMI RISOLTI**

### ❌ **Problemi Precedenti**

- **Troppi fetch simultanei**: Caricamento da multiple fonti senza coordinamento
- **Duplicazione di messaggi**: Sistema di deduplicazione complesso e non affidabile
- **Race conditions**: Listeners che si attivano prima che i dati siano pronti
- **Mancanza di stato centralizzato**: Ogni componente gestisce il proprio stato
- **Cleanup aggressivo**: Rimozione troppo frequente di messaggi processati
- **Listeners multipli**: Registrazione di listener duplicati

### ✅ **Soluzioni Implementate**

- **Flusso ordinato**: 5 step chiari e sequenziali
- **Stato centralizzato**: Gestione unificata in TokenRoomManager
- **Deduplicazione ottimizzata**: Sistema semplice e affidabile
- **Paginazione**: Caricamento controllato dei messaggi
- **Inizializzazione asincrona**: Setup ordinato e controllato

## **NUOVO FLUSSO ORDINATO**

### **STEP 1: Inizializzazione**

```typescript
// Il manager si inizializza automaticamente
await tokenRoomManager.initialize();
```

- Carica le stanze attive dal profilo utente
- Resetta lo stato interno
- Prepara il sistema per le operazioni

### **STEP 2: Join Stanza**

```typescript
const result = await tokenRoomManager.joinTokenRoom(roomId, token);
```

- Valida che la stanza esista
- Aggiunge la stanza alle stanze attive
- Salva il riferimento nel profilo utente
- Avvia l'ascolto se il manager è attivo

### **STEP 3: Avvio Listeners**

```typescript
await tokenRoomManager.startListeningTokenRooms();
```

- Avvia l'ascolto per tutte le stanze attive
- Gestisce un listener per stanza
- Evita duplicazioni di listener

### **STEP 4: Invio Messaggi**

```typescript
const result = await tokenRoomManager.sendTokenRoomMessage(
  roomId,
  content,
  token
);
```

- Genera ID messaggio e prepara i dati
- Cifra il contenuto con il token
- Invia a GunDB
- Traccia il messaggio inviato
- Aggiorna lo stato della stanza

### **STEP 5: Recupero Messaggi**

```typescript
const messages = await tokenRoomManager.getTokenRoomMessages(roomId, {
  limit: 50,
});
```

- Recupera messaggi da GunDB con paginazione
- Decifra i messaggi con il token
- Aggiorna lo stato della stanza
- Restituisce messaggi ordinati

## **GESTIONE STATO CENTRALIZZATA**

### **Stato del Manager**

```typescript
interface TokenRoomManagerState {
  isInitialized: boolean;
  isListening: boolean;
  activeRooms: Map<string, string>; // roomId -> token
  roomStates: Map<string, RoomState>;
  processedMessages: Map<string, number>;
  sentMessages: Set<string>;
}
```

### **Stato per Stanza**

```typescript
interface RoomState {
  isJoined: boolean;
  lastMessageId?: string;
  messageCount: number;
  lastSync: number;
}
```

## **DEDUPLICAZIONE OTTIMIZZATA**

### **Sistema Semplice**

- **Message Key**: `${roomId}:${messageId}`
- **Self-sent Detection**: Traccia messaggi appena inviati
- **Processed Tracking**: Set di messaggi già processati
- **Cleanup Intelligente**: Rimozione basata su TTL (24h)

### **Vantaggi**

- ✅ Nessuna duplicazione di messaggi
- ✅ Gestione automatica dei retry
- ✅ Performance ottimizzata
- ✅ Memoria controllata

## **PAGINAZIONE E PERFORMANCE**

### **Configurazione**

```typescript
const tokenRoomManager = new TokenRoomManager(core, encryptionManager, {
  enablePagination: true,
  pageSize: 50,
  maxProcessedMessages: 1000,
  messageTTLMs: 24 * 60 * 60 * 1000, // 24 ore
});
```

### **Vantaggi**

- ✅ Caricamento controllato dei messaggi
- ✅ Memoria limitata e prevedibile
- ✅ Performance costante
- ✅ UX fluida

## **INTEGRAZIONE CON L'APP**

### **Flusso nell'Interface**

1. **Inizializzazione**: `initializePlugin()`
2. **Caricamento Stanze**: `loadTokenRooms()`
3. **Join Stanza**: `joinRoom(roomId, token)`
4. **Caricamento Messaggi**: `loadRoomMessages(roomId)`
5. **Invio Messaggi**: `sendMessage(content)`

### **Gestione Errori**

- ✅ Errori specifici per ogni step
- ✅ Retry automatici dove appropriato
- ✅ Feedback utente chiaro
- ✅ Stato di caricamento visibile

## **MONITORAGGIO E DEBUG**

### **Status Events**

```typescript
tokenRoomManager.onStatus((event) => {
  console.log("TokenRoom Status:", event);
  // event.type: 'manager:init:start' | 'room:join:success' | 'message:send:success' | ...
});
```

### **UX Snapshot**

```typescript
const snapshot = tokenRoomManager.getUxSnapshot();
// {
//   isInitialized: boolean,
//   isListening: boolean,
//   activeRooms: number,
//   listeners: number,
//   processedMessages: number
// }
```

## **VANTAGGI DEL NUOVO SISTEMA**

### **Per gli Sviluppatori**

- ✅ Flusso chiaro e prevedibile
- ✅ API semplice e consistente
- ✅ Debugging facilitato
- ✅ Testing semplificato

### **Per gli Utenti**

- ✅ Nessuna duplicazione di messaggi
- ✅ Caricamento veloce e fluido
- ✅ Stato sempre sincronizzato
- ✅ Feedback chiaro delle operazioni

### **Per il Sistema**

- ✅ Performance ottimizzata
- ✅ Memoria controllata
- ✅ Scalabilità migliorata
- ✅ Affidabilità aumentata

## **MIGRAZIONE**

### **Cambiamenti Necessari**

1. **Plugin Initialization**: Ora asincrona
2. **Room Management**: Usa il nuovo flusso
3. **Message Handling**: Sistema unificato
4. **Error Handling**: Gestione centralizzata

### **Compatibilità**

- ✅ API backward compatible dove possibile
- ✅ Fallback per metodi deprecati
- ✅ Migrazione graduale supportata

## **CONCLUSIONI**

Il nuovo sistema risolve tutti i problemi identificati:

1. **✅ Ordine**: Flusso chiaro e sequenziale
2. **✅ Performance**: Paginazione e deduplicazione ottimizzate
3. **✅ Affidabilità**: Gestione errori robusta
4. **✅ Manutenibilità**: Codice pulito e ben strutturato
5. **✅ UX**: Feedback chiaro e stato sincronizzato

Il sistema è ora **pronto per la produzione** e può gestire efficacemente le token rooms con un flusso ordinato e prevedibile.
