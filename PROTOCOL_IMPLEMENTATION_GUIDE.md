# Guida all'Implementazione del Protocollo di Messaggistica Shogun

## Panoramica del Protocollo

Il protocollo di messaggistica Shogun è un sistema peer-to-peer decentralizzato basato su GunDB che implementa messaggistica end-to-end crittografata. Segue la filosofia di Mark Nadal: **decentralizzazione radicale**, **resilienza offline-first**, e **minimalismo architetturale**.

### Principi Fondamentali

- **Verità decentralizzata**: Nessuna singola fonte di verità, ogni nodo è autonomo
- **Offline-first**: Il sistema funziona anche senza connessione di rete
- **Resilienza contro fallibilità**: Ogni componente può fallire senza compromettere il sistema
- **Crittografia end-to-end**: Tutti i messaggi sono crittografati con chiavi condivise

## Architettura del Sistema

### Componenti Principali

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   UX Layer      │    │  Protocol Layer  │    │   GunDB Layer   │
│                 │    │                  │    │                 │
│ - UI Components │◄──►│ - MessagingPlugin│◄──►│ - Data Storage  │
│ - Event Handlers│    │ - EncryptionMgr  │    │ - P2P Network   │
│ - State Mgmt    │    │ - MessageProcessor│    │ - SEA Crypto    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Struttura dei Dati

Il protocollo organizza i messaggi in una struttura gerarchica:

```
GunDB Root
├── msg_{recipientPub}/           # Messaggi per un destinatario specifico
│   └── {date}/                   # Organizzazione per data (YYYY-MM-DD)
│       └── {messageId}/          # Singolo messaggio
│           ├── data              # Contenuto crittografato
│           ├── from              # Chiave pubblica del mittente
│           ├── senderEpub        # Chiave di crittografia del mittente
│           ├── timestamp         # Timestamp del messaggio
│           └── id                # ID univoco del messaggio
├── shogun/
│   ├── users/                    # Registro utenti dell'app
│   └── usernames/                # Mapping username -> chiave pubblica
└── ~{userPub}/                   # Spazio pubblico dell'utente
    └── epub                      # Chiave di crittografia pubblica
```

## Implementazione per Programmatore UX

### 1. Inizializzazione del Plugin

```typescript
import { MessagingPlugin } from 'shogun-message-plugin';
import { ShogunCore } from 'shogun-core';

// Inizializza il core Shogun
const core = new ShogunCore({
  // configurazione del core
});

// Inizializza il plugin di messaggistica
const messagingPlugin = new MessagingPlugin();
await messagingPlugin.initialize(core);

// Verifica che l'utente sia autenticato
if (!core.isLoggedIn()) {
  throw new Error('Utente non autenticato');
}
```

### 2. Invio di Messaggi

#### Flusso di Invio

```typescript
async function sendMessage(recipientPub: string, content: string): Promise<boolean> {
  try {
    // 1. Validazione input
    if (!recipientPub || !content) {
      throw new Error('Parametri mancanti');
    }

    // 2. Invio del messaggio
    const result = await messagingPlugin.sendMessage(recipientPub, content);
    
    if (result.success) {
      console.log('Messaggio inviato:', result.messageId);
      return true;
    } else {
      console.error('Errore invio:', result.error);
      return false;
    }
  } catch (error) {
    console.error('Errore critico:', error);
    return false;
  }
}
```

#### Processo Interno di Invio

1. **Generazione ID**: `msg_{timestamp}_{random}`
2. **Recupero EPUB**: Ottiene la chiave di crittografia del destinatario
3. **Derivazione Chiave Condivisa**: `SEA.secret(recipientEpub, senderPair)`
4. **Crittografia**: `SEA.encrypt(messageContent, sharedSecret)`
5. **Salvataggio**: Scrive nel path `msg_{recipientPub}/{date}/{messageId}`

### 3. Ricezione di Messaggi

#### Setup del Listener

```typescript
// Configura il callback per i nuovi messaggi
messagingPlugin.onMessage((message) => {
  console.log('Nuovo messaggio ricevuto:', {
    from: message.from,
    content: message.content,
    timestamp: message.timestamp,
    id: message.id
  });
  
  // Aggiorna l'UI
  updateMessageList(message);
});

// Avvia l'ascolto
messagingPlugin.startListening();
```

#### Processo di Ricezione

1. **Ascolto Path**: Monitora `msg_{currentUserPub}/`
2. **Rilevamento Nuovi Messaggi**: GunDB notifica automaticamente
3. **Decrittografia**: `SEA.decrypt(encryptedData, sharedSecret)`
4. **Callback**: Chiama la funzione registrata con il messaggio decrittografato

### 4. Gestione delle Conversazioni

#### Recupero Cronologia

```typescript
async function getMessageHistory(participantPub: string, limit: number = 50) {
  try {
    const messages = await messagingPlugin.getMessageHistory(participantPub, limit);
    return messages.sort((a, b) => a.timestamp - b.timestamp);
  } catch (error) {
    console.error('Errore recupero cronologia:', error);
    return [];
  }
}
```

#### Lista Conversazioni

```typescript
async function getConversations() {
  try {
    const conversations = await messagingPlugin.getConversations();
    return conversations.map(conv => ({
      participant: conv.participantPub,
      lastMessage: conv.lastMessage?.content,
      unreadCount: conv.unreadCount,
      lastActivity: conv.lastActivity
    }));
  } catch (error) {
    console.error('Errore recupero conversazioni:', error);
    return [];
  }
}
```

### 5. Gestione degli Errori

#### Tipi di Errore Comuni

```typescript
enum MessagingError {
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  ENCRYPTION_FAILED = 'ENCRYPTION_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  RATE_LIMITED = 'RATE_LIMITED'
}

function handleMessagingError(error: any): MessagingError {
  if (error.message?.includes('Cannot find encryption public key')) {
    return MessagingError.USER_NOT_FOUND;
  }
  if (error.message?.includes('Unable to derive shared secret')) {
    return MessagingError.ENCRYPTION_FAILED;
  }
  if (error.message?.includes('Network')) {
    return MessagingError.NETWORK_ERROR;
  }
  return MessagingError.INVALID_MESSAGE;
}
```

#### Gestione Resiliente

```typescript
async function resilientSendMessage(recipientPub: string, content: string, maxRetries: number = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await sendMessage(recipientPub, content);
      if (result) return true;
    } catch (error) {
      const errorType = handleMessagingError(error);
      
      if (errorType === MessagingError.USER_NOT_FOUND) {
        // L'utente potrebbe non essere ancora online
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        continue;
      }
      
      if (errorType === MessagingError.NETWORK_ERROR) {
        // Retry con backoff esponenziale
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        continue;
      }
      
      // Errori non recuperabili
      throw error;
    }
  }
  
  throw new Error('Tentativi esauriti');
}
```

### 6. Ottimizzazioni UX

#### Caching Locale

```typescript
class MessageCache {
  private cache = new Map<string, any[]>();
  private maxSize = 1000;

  addMessages(conversationId: string, messages: any[]) {
    if (!this.cache.has(conversationId)) {
      this.cache.set(conversationId, []);
    }
    
    const existing = this.cache.get(conversationId)!;
    const newMessages = messages.filter(msg => 
      !existing.some(existing => existing.id === msg.id)
    );
    
    existing.push(...newMessages);
    existing.sort((a, b) => a.timestamp - b.timestamp);
    
    // Mantieni solo i messaggi più recenti
    if (existing.length > this.maxSize) {
      existing.splice(0, existing.length - this.maxSize);
    }
  }

  getMessages(conversationId: string): any[] {
    return this.cache.get(conversationId) || [];
  }
}
```

#### Indicatori di Stato

```typescript
enum MessageStatus {
  SENDING = 'sending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed'
}

class MessageStateManager {
  private messageStates = new Map<string, MessageStatus>();

  setMessageStatus(messageId: string, status: MessageStatus) {
    this.messageStates.set(messageId, status);
    this.notifyUI(messageId, status);
  }

  getMessageStatus(messageId: string): MessageStatus {
    return this.messageStates.get(messageId) || MessageStatus.SENT;
  }

  private notifyUI(messageId: string, status: MessageStatus) {
    // Aggiorna l'UI con il nuovo stato
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageElement) {
      messageElement.setAttribute('data-status', status);
    }
  }
}
```

### 7. Best Practices per l'UX

#### Feedback Immediato

```typescript
async function sendMessageWithFeedback(recipientPub: string, content: string) {
  const messageId = generateTempId();
  const stateManager = new MessageStateManager();
  
  // Mostra immediatamente il messaggio come "invio in corso"
  stateManager.setMessageStatus(messageId, MessageStatus.SENDING);
  addMessageToUI({
    id: messageId,
    content,
    status: MessageStatus.SENDING,
    timestamp: Date.now()
  });

  try {
    const result = await sendMessage(recipientPub, content);
    
    if (result.success) {
      // Aggiorna con l'ID reale e stato "inviato"
      updateMessageId(messageId, result.messageId!);
      stateManager.setMessageStatus(result.messageId!, MessageStatus.SENT);
    } else {
      stateManager.setMessageStatus(messageId, MessageStatus.FAILED);
    }
  } catch (error) {
    stateManager.setMessageStatus(messageId, MessageStatus.FAILED);
  }
}
```

#### Gestione Offline

```typescript
class OfflineManager {
  private isOnline = navigator.onLine;
  private pendingMessages: any[] = [];

  constructor() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.processPendingMessages();
    });
    
    window.addEventListener('offline', () => {
      this.isOnline = false;
    });
  }

  async sendMessage(recipientPub: string, content: string) {
    if (!this.isOnline) {
      // Salva in coda locale
      this.pendingMessages.push({ recipientPub, content, timestamp: Date.now() });
      this.showOfflineIndicator();
      return { success: false, error: 'Offline' };
    }
    
    return await sendMessage(recipientPub, content);
  }

  private async processPendingMessages() {
    const messages = [...this.pendingMessages];
    this.pendingMessages = [];
    
    for (const message of messages) {
      try {
        await sendMessage(message.recipientPub, message.content);
      } catch (error) {
        // Rimetti in coda se fallisce
        this.pendingMessages.push(message);
      }
    }
  }
}
```

### 8. Sicurezza e Privacy

#### Validazione Input

```typescript
function validateMessageContent(content: string): boolean {
  // Lunghezza massima
  if (content.length > 10000) return false;
  
  // Caratteri pericolosi
  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /data:/i
  ];
  
  return !dangerousPatterns.some(pattern => pattern.test(content));
}

function sanitizeMessageContent(content: string): string {
  return content
    .replace(/[<>]/g, '') // Rimuovi tag HTML
    .trim()
    .substring(0, 10000); // Limita lunghezza
}
```

#### Rate Limiting

```typescript
class MessageRateLimiter {
  private messageCounts = new Map<string, number[]>();
  private maxMessagesPerMinute = 30;

  canSendMessage(userPub: string): boolean {
    const now = Date.now();
    const userMessages = this.messageCounts.get(userPub) || [];
    
    // Rimuovi messaggi più vecchi di 1 minuto
    const recentMessages = userMessages.filter(timestamp => 
      now - timestamp < 60000
    );
    
    this.messageCounts.set(userPub, recentMessages);
    
    return recentMessages.length < this.maxMessagesPerMinute;
  }

  recordMessage(userPub: string) {
    const userMessages = this.messageCounts.get(userPub) || [];
    userMessages.push(Date.now());
    this.messageCounts.set(userPub, userMessages);
  }
}
```

## Conclusione

Questo protocollo implementa una messaggistica veramente decentralizzata seguendo i principi di Mark Nadal. Ogni messaggio è un nodo indipendente nel grafo GunDB, ogni utente è un peer autonomo, e la resilienza è costruita nel DNA del sistema.

**La chiave è pensare in termini di "gossip" piuttosto che "richiesta/risposta"** - i messaggi si propagano attraverso la rete come informazioni che convergono verso la verità, non come transazioni che dipendono da un server centrale.

Il sistema è progettato per sopravvivere alla caduta di qualsiasi singolo componente, proprio come un ecosistema naturale dove la morte di un singolo organismo non compromette l'intera foresta.
