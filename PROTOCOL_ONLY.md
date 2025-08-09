# 🚀 Shogun Messaging Plugin - Protocol Only

## ✅ **NUOVO DESIGN: Solo Protocollo**

Il plugin ora contiene **SOLO** le funzioni del protocollo di messaggistica. Tutta la logica UI è stata spostata nell'app.

### 🎯 **API DEL PLUGIN** (solo 4 funzioni di invio + supporto)

#### **Core Send Functions:**

```typescript
// 1. Messaggi privati 1-a-1 (cifrati E2E)
await messagingPlugin.sendMessage(recipientPub, messageContent);

// 2. Messaggi di gruppo (cifrati con chiave gruppo)
await messagingPlugin.sendGroupMessage(groupId, messageContent);

// 3. Messaggi stanze token (cifrati con token condiviso)
await messagingPlugin.sendTokenRoomMessage(roomId, messageContent, token);

// 4. Messaggi pubblici (firmati, non cifrati)
await messagingPlugin.sendPublicMessage(roomId, messageContent);
```

#### **Protocol Support Functions:**

```typescript
// Creazione gruppi/stanze
await messagingPlugin.createGroup(name, memberPubs);
await messagingPlugin.createTokenRoom(name, description);
await messagingPlugin.joinTokenRoom(roomId, token);

// Gestione chiavi crittografiche
await messagingPlugin.getRecipientEpub(userPub);
await messagingPlugin.publishUserEpub();

// Listener protocollo (raw data)
messagingPlugin.onRawMessage(callback);
messagingPlugin.onRawPublicMessage(callback);
messagingPlugin.onRawGroupMessage(callback);
messagingPlugin.onRawTokenRoomMessage(callback);
```

---

## 🖥️ **NELL'APP: UI Layer**

### **ChatUIManager** (`app/src/utils/chatUIManager.ts`)

Gestisce lo stato UI delle chat:

- `joinChat()` - Logica UI per entrare in chat
- `getMyChats()` - Chat dell'utente formattate per UI
- `generateInviteLink()` - Link di invito per condivisione
- Storage locale dei riferimenti chat

### **useMessagingUI Hook** (`app/src/hooks/useMessagingUI.ts`)

Hook React per stato UI dei messaggi:

- Wrapper delle funzioni del protocollo
- Formattazione messaggi per UI
- Gestione stato React (messaggi, chat, listeners)
- Contatori non letti, timestamp, etc.

---

## 🏗️ **ARCHITETTURA**

```
┌─────────────────────────────────────┐
│               APP                   │
│  ┌─────────────────────────────────┐│
│  │        UI LAYER                 ││
│  │  • ChatUIManager               ││
│  │  • useMessagingUI              ││
│  │  • React Components           ││
│  │  • State Management           ││
│  │  • localStorage               ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
               ↕ ️
┌─────────────────────────────────────┐
│           MESSAGING PLUGIN          │
│  ┌─────────────────────────────────┐│
│  │     PROTOCOL LAYER              ││
│  │  • 4 Send Functions            ││
│  │  • Encryption (E2E)            ││
│  │  • P2P Communication           ││
│  │  • GunDB Integration           ││
│  │  • Raw Message Listeners       ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

---

## 🎉 **VANTAGGI**

✅ **Separazione pulita** protocollo vs UI  
✅ **Plugin riutilizzabile** per altre app  
✅ **Testing semplificato** (protocollo isolato)  
✅ **Performance migliore** (meno dipendenze nel plugin)  
✅ **Manutenibilità** (responsabilità chiare)

---

## 🚀 **UTILIZZO NELL'APP**

```typescript
// 1. Inizializza plugin (solo protocollo)
const messagingPlugin = new MessagingPlugin();
await messagingPlugin.initialize(shogunCore);

// 2. Usa hook UI nell'app
const { sendMessage, joinChat, chats, messages, startListening } =
  useMessagingUI(messagingPlugin, currentUserPub);

// 3. Invia messaggi attraverso l'UI layer
await sendMessage("private", recipientPub, "Hello!");
await sendMessage("group", groupId, "Group message");
```
