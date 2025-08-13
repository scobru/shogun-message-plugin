# Debug Room Persistence - TokenRoomManager

## **PROBLEMA IDENTIFICATO**

### ❌ **Sintomo**

- `getActiveRooms()` restituisce array vuoto `[]`
- Le stanze create non appaiono nella lista
- Nessuna persistenza tra sessioni

### 🔍 **Debug Implementato**

#### **1. Logging in `_loadActiveRooms()`**

```typescript
console.log("🔍 _loadActiveRooms: Loading rooms from user profile");
const userData = await this.core.db.getUserData("chats/token");
console.log("🔍 _loadActiveRooms: User data retrieved:", userData);

// Per ogni stanza trovata
console.log("🔍 _loadActiveRooms: Processing room:", roomId, roomData);
console.log("🔍 _loadActiveRooms: Adding room to active rooms:", roomId);

// Risultato finale
console.log(
  "🔍 _loadActiveRooms: Final active rooms:",
  Array.from(this.activeTokenRooms.keys())
);
```

#### **2. Logging in `_storeRoomReference()`**

```typescript
console.log("🔍 _storeRoomReference: Storing room reference:", {
  roomId,
  roomName,
});
console.log("🔍 _storeRoomReference: Room reference data:", roomReference);
await this.core.db.putUserData(`chats/token/${roomId}`, roomReference);
console.log("🔍 _storeRoomReference: Room reference stored successfully");
```

#### **3. Logging in `createTokenRoom()`**

```typescript
console.log("🔍 createTokenRoom: Starting creation for:", roomName);
console.log("🔍 createTokenRoom: Generated room data:", {
  roomId,
  token,
  currentUserPub,
});
console.log("🔍 createTokenRoom: Room data created:", roomData);
console.log("🔍 createTokenRoom: Storing room data to path:", roomPath);
console.log("🔍 createTokenRoom: Storing room reference");
console.log("🔍 createTokenRoom: Adding to active rooms");
console.log(
  "🔍 createTokenRoom: Final active rooms:",
  Array.from(this.activeTokenRooms.keys())
);
```

#### **4. Logging in `getActiveRooms()`**

```typescript
const activeRooms = Array.from(this.activeTokenRooms.keys());
console.log("🔍 getActiveRooms: Returning active rooms:", activeRooms);
console.log(
  "🔍 getActiveRooms: Active rooms map size:",
  this.activeTokenRooms.size
);
return activeRooms;
```

## **POSSIBILI CAUSE**

### **1. Inizializzazione Non Completata**

- `_loadActiveRooms()` viene chiamata prima che l'utente sia completamente loggato
- `this.core.db.user` non è disponibile durante l'inizializzazione

### **2. Errore nel Salvataggio**

- `putUserData()` fallisce silenziosamente
- Dati non vengono salvati nel formato corretto

### **3. Errore nel Caricamento**

- `getUserData()` restituisce dati in formato non atteso
- Parsing dei dati fallisce

### **4. Reset dello Stato**

- `_resetState()` viene chiamata e cancella `activeTokenRooms`
- Inizializzazione multipla cancella i dati

## **TESTING PLAN**

### **Test 1: Creazione Stanza**

1. Crea una nuova stanza
2. Verifica log di `createTokenRoom`
3. Verifica log di `_storeRoomReference`
4. Verifica che `activeTokenRooms` contenga la stanza

### **Test 2: Caricamento Stanze**

1. Ricarica la pagina
2. Verifica log di `_loadActiveRooms`
3. Verifica log di `getActiveRooms`
4. Verifica che le stanze vengano caricate

### **Test 3: Persistenza Dati**

1. Verifica che `getUserData("chats/token")` restituisca dati
2. Verifica formato dei dati salvati
3. Verifica che i dati vengano parsati correttamente

## **RISULTATI ATTESI**

### **Log Attesi per Creazione**

```
🔍 createTokenRoom: Starting creation for: Test Room
🔍 createTokenRoom: Generated room data: { roomId: "tr_xxx", token: "yyy", currentUserPub: "zzz" }
🔍 createTokenRoom: Room data created: { id: "tr_xxx", name: "Test Room", ... }
🔍 createTokenRoom: Storing room data to path: tokenRoom_tr_xxx
🔍 createTokenRoom: Storing room reference
🔍 _storeRoomReference: Storing room reference: { roomId: "tr_xxx", roomName: "Test Room" }
🔍 _storeRoomReference: Room reference stored successfully
🔍 createTokenRoom: Adding to active rooms
🔍 createTokenRoom: Final active rooms: ["tr_xxx"]
```

### **Log Attesi per Caricamento**

```
🔍 _loadActiveRooms: Loading rooms from user profile
🔍 _loadActiveRooms: User data retrieved: { "tr_xxx": { type: "token", id: "tr_xxx", ... } }
🔍 _loadActiveRooms: Processing room: tr_xxx { type: "token", id: "tr_xxx", ... }
🔍 _loadActiveRooms: Adding room to active rooms: tr_xxx
🔍 _loadActiveRooms: Final active rooms: ["tr_xxx"]
🔍 getActiveRooms: Returning active rooms: ["tr_xxx"]
🔍 getActiveRooms: Active rooms map size: 1
```

## **NEXT STEPS**

1. **Eseguire i test** con i log implementati
2. **Identificare il punto di fallimento** dai log
3. **Correggere il problema specifico** identificato
4. **Verificare la persistenza** dopo le correzioni

## **CONCLUSIONI**

I log implementati permetteranno di:

- **Tracciare il flusso completo** di creazione e caricamento stanze
- **Identificare il punto esatto** dove fallisce la persistenza
- **Verificare i dati** salvati e caricati
- **Risolvere il problema** in modo mirato

Una volta identificato il problema, potremo implementare la correzione specifica necessaria.
