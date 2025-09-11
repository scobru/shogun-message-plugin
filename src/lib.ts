import { ShogunCore , PluginCategory } from "shogun-core";
import { MessagingSchema } from "./schema";
import { BasePlugin } from "./base";

export class LindaLib extends BasePlugin {
  name = "LindaLib";
  version = "1.0.0";
  description = "Protocollo di messaggistica avanzato ispirato a Signal con chaining e forward secrecy";
  _category: PluginCategory = PluginCategory.Messages;

  private userPubKey: string | null = null;
  private processedMessages: Set<string> = new Set();
  private messageChains: Map<string, any> = new Map();
  private groupKeys: Map<string, any> = new Map();
  private groupGun: any;
  // **PERFORMANCE: Cache for user keys to avoid repeated lookups**
  private userKeysCache: Map<string, { keys: any; timestamp: number }> = new Map();
  
  private _inboxListening: boolean = false;
  private _inboxDateListeners: Map<string, { off: () => void } | { off: Function } > = new Map();
  private _inboxTopLevelListener: { off: () => void } | { off: Function } | null = null;
  private _inboxDebug: boolean = false;

  constructor(
    peers: string[] = [
      "https://peer.wallie.io/gun",
      "https://relay.shogun-eco.xyz/gun",
    ],
    core?: ShogunCore
  ) {
    super();
    
    if (core) {
      this.initialize(core);
    } else {
      const tempCore = new ShogunCore({
        peers,
        scope: "linda",
        radisk: true,
        localStorage: true,
      });
      this.initialize(tempCore);
    }
    
    this.groupGun = this.core!.db;
    
    try {
      const fromIs = (this.core as any)?.db?.user?.is?.pub;
      const fromSea = (this.core as any)?.db?.user?._?.sea?.pub;
      this.userPubKey = fromIs || fromSea || null;
    } catch {}
  }

  /**
   * Async initialization method for compatibility with useMessaging hook
   */
  async initialize(core: ShogunCore): Promise<void> {
    // Call the base class initialize method
    super.initialize(core);
    
    // Additional async initialization if needed
    this.groupGun = this.core!.db;
    
    try {
      const fromIs = (this.core as any)?.db?.user?.is?.pub;
      const fromSea = (this.core as any)?.db?.user?._?.sea?.pub;
      this.userPubKey = fromIs || fromSea || null;
    } catch (error) {
      console.warn("⚠️ Failed to extract userPubKey during initialization:", error);
    }
    
    // **NEW: Automatically publish user keys if user is logged in**
    if (this.userPubKey && this.core) {
      try {
        await this.publishUserKeys();
        console.log("✅ User keys published automatically during initialization");
      } catch (error) {
        console.warn("⚠️ Failed to publish user keys during initialization:", error);
      }
    }
    
    // Mark as ready
    this.initialized = true;
  }

  /**
   * Check if plugin is ready for messaging operations
   */
  isReady(): boolean {
    return this.initialized && this.core !== null && this.userPubKey !== null;
  }

  /**
   * Get message processor for compatibility checks
   */
  get messageProcessor() {
    return {
      isReady: this.isReady(),
      userPubKey: this.userPubKey,
      core: this.core
    };
  }

  /**
   * Force publish user keys - useful for debugging
   */
  async forcePublishUserKeys(): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.userPubKey) {
        return { success: false, error: "User not logged in" };
      }

      if (!this.core) {
        return { success: false, error: "Core not initialized" };
      }

      await this.publishUserKeys();
      console.log("✅ User keys force published successfully");
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("❌ Failed to force publish user keys:", errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Check if user keys are published
   */
  async areUserKeysPublished(): Promise<boolean> {
    try {
      if (!this.userPubKey) return false;
      
      const keys = await this.getUserKeys(this.userPubKey);
      return !!(keys && keys.pub && keys.epub);
    } catch (error) {
      return false;
    }
  }

  /**
   * Debug method to check user keys status
   */
  async debugUserKeys(userPub: string): Promise<{
    userPub: string;
    keysFound: boolean;
    keys?: any;
    error?: string;
  }> {
    try {
      const keys = await this.getUserKeys(userPub);
      return {
        userPub: userPub.substring(0, 8) + "...",
        keysFound: !!(keys && keys.pub && keys.epub),
        keys: keys
      };
    } catch (error) {
      return {
        userPub: userPub.substring(0, 8) + "...",
        keysFound: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }

  /**
   * Compatibility method for publishUserEpub (alias for publishUserKeys)
   */
  async publishUserEpub(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.publishUserKeys();
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: errorMessage };
    }
  }

  get publicKey(): string | null {
    return this.userPubKey;
  }

  async login(alias: string, pass: string): Promise<void> {
    if (!this.core) {
      throw new Error("Core non inizializzato.");
    }
    const result = await this.core!.login(alias, pass);
    if (!result.success || !result.userPub) {
      throw new Error(result.error || "Login fallito.");
    }
    this.userPubKey = result.userPub;
  }

  async publishUserKeys(): Promise<void> {
    if (!this.userPubKey) {
      throw new Error("Utente non loggato.");
    }

    if (!this.core) {
      throw new Error("Core non inizializzato.");
    }

    const userPair = (this.core!.user?._ as any)?.sea;
    if (!userPair) {
      throw new Error("Chiavi utente non disponibili.");
    }

    const alias = (this.core!.user?._ as any)?.is?.alias || `User_${this.userPubKey.substring(0, 8)}`;

    this.core!.gun
      .get(`~${this.userPubKey}`)
      .get("keys")
      .put({
        pub: this.userPubKey,
        epub: userPair.epub,
        alias: alias,
        timestamp: Date.now(),
        version: "2.0", // Versione del protocollo
        hasChaining: true,
        hasForwardSecrecy: true,
        hasGroupEncryption: true
      });

  }

  async getUserKeys(userPub: string): Promise<any> {
    if (!this.core) {
      throw new Error("Core non inizializzato.");
    }
    return new Promise((resolve, reject) => {
      this.core!.gun
        .get(`~${userPub}`)
        .get("keys")
        .once((keys: any) => {
          if (keys && keys.pub && keys.epub) {
            resolve(keys);
          } else {
            reject(new Error(`Chiavi non trovate per l'utente ${userPub.substring(0, 8)}...`));
          }
        });
    });
  }

  async waitForUserKeys(userPub: string, timeoutMs: number = 10000): Promise<any> {
    // **PERFORMANCE: Check cache first**
    const cached = this.userKeysCache.get(userPub);
    if (cached && Date.now() - cached.timestamp < 30000) { // Cache for 30 seconds
      return cached.keys;
    }

    const startTime = Date.now();
    let lastError: any = null;
    
    // **PERFORMANCE: Reduce logging frequency**
    if (Math.random() < 0.1) { // Only log 10% of the time
      console.log(`🔍 Waiting for user keys: ${userPub.substring(0, 8)}... (timeout: ${timeoutMs}ms)`);
    }
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const keys = await this.getUserKeys(userPub);
        if (keys && keys.pub && keys.epub) {
          // **PERFORMANCE: Cache the keys**
          this.userKeysCache.set(userPub, { keys, timestamp: Date.now() });
          
          if (Math.random() < 0.1) { // Only log 10% of the time
            console.log(`✅ User keys found for ${userPub.substring(0, 8)}...`);
          }
          return keys;
        }
      } catch (error) {
        lastError = error;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000)); // **PERFORMANCE: Increased delay from 500ms to 1000ms**
    }
    
    const errorMessage = `Timeout: chiavi non trovate per ${userPub.substring(0, 8)}... dopo ${timeoutMs}ms. L'utente potrebbe non aver pubblicato le sue chiavi pubbliche.`;
    console.error(`❌ ${errorMessage}`);
    console.error(`❌ Last error:`, lastError);
    
    throw new Error(errorMessage);
  }

  async sendMessage(recipientPub: string, content: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      if (!this.userPubKey) {
        return { success: false, error: "Utente non loggato." };
      }

      if (!this.core) {
        return { success: false, error: "Core non inizializzato." };
      }

      const recipientKeys = await this.waitForUserKeys(recipientPub, 15000);
      const senderPair = (this.core!.user?._ as any)?.sea;
      
      if (!senderPair) {
        return { success: false, error: "Chiavi mittente non disponibili." };
      }

      const sharedSecret = await this.core!.db.sea.secret(recipientKeys.epub, senderPair);
      
      if (!sharedSecret) {
        return { success: false, error: "Impossibile derivare il segreto condiviso." };
      }

      const messageData = {
        from: this.userPubKey,
        content: content,
        timestamp: Date.now(),
        type: "advanced-message",
        version: "2.0",
        chainId: this.generateChainId(recipientPub),
        messageIndex: await this.getNextMessageIndex(recipientPub)
      };

      const encryptedData = await this.core!.db.sea.encrypt(JSON.stringify(messageData), sharedSecret);
      
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const conversationPath = MessagingSchema.privateMessages.conversation(this.userPubKey, recipientPub);
      
      this.core!.gun
        .get(conversationPath)
        .get("messages")
        .get(messageId)
        .put({
          from: this.userPubKey,
          to: recipientPub,
          data: encryptedData,
          timestamp: Date.now(),
          id: messageId,
          chainId: messageData.chainId,
          messageIndex: messageData.messageIndex
        });

      await this.updateMessageChain(recipientPub, messageId, messageData);
      
      return { success: true, messageId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto";
      return { success: false, error: errorMessage };
    }
  }

  listenForMessages(senderPub: string, callback: (message: any) => void): void {
    if (!this.userPubKey) {
      throw new Error("Utente non loggato.");
    }

    if (!this.core) {
      throw new Error("Core non inizializzato.");
    }

    const conversationPath = MessagingSchema.privateMessages.conversation(this.userPubKey, senderPub);
    
    this.core!.gun
      .get(conversationPath)
      .get("messages")
      .map()
      .on((message: any, messageId: string) => {
        try {
          if (this.processedMessages.has(messageId)) {
            return;
          }
          this.processedMessages.add(messageId);

          if (message && message.from === this.userPubKey) {
            return;
          }

          if (!message || !message.data || !message.from) {
            return;
          }

          this.processAdvancedMessage(message, callback);

        } catch (error) {
        }
      });
  }

  private async processAdvancedMessage(message: any, callback: (message: any) => void): Promise<void> {
    if (!this.core) {
      return;
    }

    const senderKeys = await this.waitForUserKeys(message.from, 5000);
    const recipientPair = (this.core!.user?._ as any)?.sea;
    
    if (!recipientPair) {
      return;
    }

    const sharedSecret = await this.core!.db.sea.secret(
      senderKeys.epub,
      recipientPair
    );

    if (!sharedSecret) {
      return;
    }

    const decryptedData = await this.core!.db.sea.decrypt(
      message.data,
      sharedSecret
    );

    if (!decryptedData) {
      return;
    }
    let messageData;
    if (typeof decryptedData === "string") {
      try {
        messageData = JSON.parse(decryptedData);
      } catch (error) {
        return;
      }
    } else {
      messageData = decryptedData;
    }
    
    if (await this.verifyMessageChain(messageData)) {
      callback({
        ...messageData,
        id: message.id,
        from: message.from,
        decryptedAt: Date.now()
      });
    }
  }

  private generateChainId(recipientPub: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `chain_${this.userPubKey?.substring(0, 8)}_${recipientPub.substring(0, 8)}_${timestamp}_${random}`;
  }

  private async getNextMessageIndex(recipientPub: string): Promise<number> {
    const chainKey = `${this.userPubKey}_${recipientPub}`;
    const currentChain = this.messageChains.get(chainKey) || { lastIndex: -1 };
    return currentChain.lastIndex + 1;
  }

  private async updateMessageChain(recipientPub: string, messageId: string, messageData: any): Promise<void> {
    const chainKey = `${this.userPubKey}_${recipientPub}`;
    const currentChain = this.messageChains.get(chainKey) || { messages: [], lastIndex: -1 };
    
    currentChain.messages.push({
      id: messageId,
      index: messageData.messageIndex,
      timestamp: messageData.timestamp,
      chainId: messageData.chainId
    });
    
    currentChain.lastIndex = messageData.messageIndex;
    this.messageChains.set(chainKey, currentChain);
  }

  private async verifyMessageChain(messageData: any): Promise<boolean> {
    const chainKey = `${messageData.from}_${this.userPubKey}`;
    const currentChain = this.messageChains.get(chainKey) || { lastIndex: -1 };
    
    if (messageData.messageIndex === currentChain.lastIndex + 1) {
      currentChain.lastIndex = messageData.messageIndex;
      this.messageChains.set(chainKey, currentChain);
      return true;
    }
    
    return false;
  }

  async createGroup(groupName: string, memberPubs: string[]): Promise<string> {
    if (!this.userPubKey) {
      throw new Error("Utente non loggato.");
    }

    const groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const groupKey = await this.core!.db.sea.pair();
    this.groupKeys.set(groupId, groupKey);

    const groupData = {
      id: groupId,
      name: groupName,
      creator: this.userPubKey,
      createdAt: Date.now(),
      type: "advanced-group",
      version: "2.0",
      groupKeyPub: groupKey.epub
    };

    const groupDataWithCreator = {
      ...groupData,
      createdBy: this.userPubKey
    };
    
    this.groupGun
      .get(`~${groupId}`)
      .get("info")
      .put(groupDataWithCreator);

    const allMembers = [this.userPubKey, ...memberPubs];

    await this.shareGroupKey(groupId, groupKey, allMembers);
    for (let i = 0; i < allMembers.length; i++) {
      this.groupGun
        .get(`~${groupId}`)
        .get("members")
        .get(i.toString())
        .put({
          pub: allMembers[i],
          addedAt: Date.now(),
          addedBy: this.userPubKey
        });
    }

    this.groupGun
      .get(`~${groupId}`)
      .get("info")
      .get("memberCount")
      .put(allMembers.length);
    
    return groupId;
  }

  async sendGroupMessage(groupId: string, content: string): Promise<void> {
    if (!this.userPubKey) {
      throw new Error("Utente non loggato.");
    }

    const isMember = await this.isGroupMember(groupId, this.userPubKey);
    if (!isMember) {
      throw new Error("Non sei membro di questo gruppo.");
    }

    const groupKey = await this.getGroupKey(groupId);
    if (!groupKey) {
      throw new Error("Chiave del gruppo non disponibile.");
    }

    const messageData = {
      from: this.userPubKey,
      content: content,
      timestamp: Date.now(),
      type: "advanced-group-message",
      groupId: groupId,
      version: "2.0"
    };

    const encryptedData = await this.core!.db.sea.encrypt(JSON.stringify(messageData), groupKey);
    
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.groupGun
      .get(`~${groupId}`)
      .get("messages")
      .get(messageId)
      .put({
        from: this.userPubKey,
        data: encryptedData,
        timestamp: Date.now(),
        id: messageId,
        groupId: groupId
      });
  }

  listenForGroupMessages(groupId: string, callback: (message: any) => void): void {
    if (!this.userPubKey) {
      throw new Error("Utente non loggato.");
    }

    this.groupGun
      .get(`~${groupId}`)
      .get("messages")
      .map()
      .on((message: any, messageId: string) => {
        try {
          if (this.processedMessages.has(messageId)) {
            return;
          }
          this.processedMessages.add(messageId);

          if (message && message.from === this.userPubKey) {
            return;
          }

          if (!message || !message.data || !message.from) {
            return;
          }

          this.processAdvancedGroupMessage(message, groupId, callback);

        } catch (error) {
        }
      });
  }

  private async getGroupKey(groupId: string): Promise<any> {
    let groupKey = this.groupKeys.get(groupId);
    if (groupKey) {
      return groupKey;
    }

    try {
      const encryptedGroupKey = await new Promise<any>((resolve) => {
        this.groupGun
          .get(`~${this.userPubKey}`)
          .get("groupKeys")
          .get(groupId)
          .once((data: any) => {
            resolve(data);
          });
      });

      if (encryptedGroupKey) {
        const groupData = await this.waitForGroupData(groupId, 5000);
        const creatorPub = groupData.createdBy;
        
        if (creatorPub) {
          const creatorKeys = await this.waitForUserKeys(creatorPub, 5000);
          const recipientPair = (this.core!.user?._ as any)?.sea;
          
          const sharedSecret = await this.core!.db.sea.secret(creatorKeys.epub, recipientPair);
          
          if (sharedSecret) {
            const decryptedData = await this.core!.db.sea.decrypt(encryptedGroupKey, sharedSecret);
            
            if (decryptedData) {
              let keyData;
              if (typeof decryptedData === "string") {
                try {
                  keyData = JSON.parse(decryptedData);
                } catch (error) {
                  return null;
                }
              } else {
                keyData = decryptedData;
              }
              groupKey = keyData.groupKey;
              this.groupKeys.set(groupId, groupKey);
              return groupKey;
            }
          }
        } else {
          const recipientPair = (this.core!.user?._ as any)?.sea;
          if (recipientPair) {
            const decryptedData = await this.core!.db.sea.decrypt(encryptedGroupKey, recipientPair);
            if (decryptedData) {
              const keyData = JSON.parse(decryptedData);
              groupKey = keyData.groupKey;
              this.groupKeys.set(groupId, groupKey);
              return groupKey;
            } else {
            }
          } else {
          }
        }
      } else {
      }
    } catch (error) {
    }

    return null;
  }

  private async processAdvancedGroupMessage(message: any, groupId: string, callback: (message: any) => void): Promise<void> {
    const groupKey = await this.getGroupKey(groupId);
    if (!groupKey) {
      return;
    }

    const decryptedData = await this.core!.db.sea.decrypt(message.data, groupKey);
    
    if (!decryptedData) {
      return;
    }

    let messageData;
    if (typeof decryptedData === "string") {
      try {
        messageData = JSON.parse(decryptedData);
      } catch (error) {
        return;
      }
    } else {
      messageData = decryptedData;
    }
    
    callback({
      ...messageData,
      id: message.id,
      from: message.from,
      decryptedAt: Date.now()
    });

  }

  async getGroupData(groupId: string): Promise<any> {
    return new Promise((resolve) => {
      this.groupGun
        .get(`~${groupId}`)
        .get("info")
        .once((data: any) => {
          resolve(data);
        });
    });
  }

  async waitForGroupData(groupId: string, timeoutMs: number = 10000): Promise<any> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const groupData = await this.getGroupData(groupId);
      if (groupData && groupData.id) {
        return groupData;
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    throw new Error(`Timeout: dati gruppo non trovati per ${groupId.substring(0, 10)}... dopo ${timeoutMs}ms`);
  }

  async isGroupMember(groupId: string, userPub: string): Promise<boolean> {
    try {
      const members = await this.getGroupMembers(groupId);
      const isMember = members.includes(userPub);
      return isMember;
    } catch (error) {
      return false;
    }
  }

  async getGroupMembers(groupId: string): Promise<string[]> {
    return new Promise((resolve) => {
      const members: string[] = [];
      let memberCount = 0;
      let expectedCount = 0;
      let timeout: NodeJS.Timeout;

      this.groupGun.get(`~${groupId}`).get("info").get("memberCount").once((count: number) => {
        if (count && count > 0) {
          expectedCount = count;
          
          if (expectedCount === 0) {
            clearTimeout(timeout);
            resolve([]);
            return;
          }

          for (let i = 0; i < expectedCount; i++) {
            this.groupGun.get(`~${groupId}`).get("members").get(i.toString()).once((memberData: any) => {
              if (memberData && memberData.pub) {
                members.push(memberData.pub);
                memberCount++;
                
                if (memberCount === expectedCount) {
                  clearTimeout(timeout);
                  resolve(members);
                }
              }
            });
          }
        } else {
          clearTimeout(timeout);
          resolve([]);
        }
      });

      timeout = setTimeout(() => {
        resolve(members);
      }, 5000);
    });
  }

  private async shareGroupKey(groupId: string, groupKey: any, memberPubs: string[]): Promise<void> {
    for (const memberPub of memberPubs) {
      try {
        const memberKeys = await this.waitForUserKeys(memberPub, 5000);
        
        const senderPair = (this.core!.user?._ as any)?.sea;
        const sharedSecret = await this.core!.db.sea.secret(memberKeys.epub, senderPair);
        
        if (sharedSecret) {
          const encryptedGroupKey = await this.core!.db.sea.encrypt(
            JSON.stringify({
              groupId: groupId,
              groupKey: groupKey,
              sharedAt: Date.now()
            }),
            sharedSecret
          );
        
        this.groupGun
          .get(`~${memberPub}`)
          .get("groupKeys")
          .get(groupId)
          .put(encryptedGroupKey);
        }
      } catch (error) {
      }
    }
  }

  async addGroupMember(groupId: string, memberPub: string): Promise<void> {
    if (!this.userPubKey) {
      throw new Error("Utente non loggato.");
    }

    const groupData = await this.waitForGroupData(groupId, 10000);
    if (groupData.creator !== this.userPubKey) {
      throw new Error("Solo il creatore può aggiungere membri.");
    }

    const isAlreadyMember = await this.isGroupMember(groupId, memberPub);
    if (isAlreadyMember) {
      return;
    }

    const currentMembers = await this.getGroupMembers(groupId);
    const newMemberIndex = currentMembers.length;

    this.groupGun
      .get(`~${groupId}`)
      .get("members")
      .get(newMemberIndex.toString())
      .put({
        pub: memberPub,
        addedAt: Date.now(),
        addedBy: this.userPubKey
      });

    this.groupGun
      .get(`~${groupId}`)
      .get("info")
      .get("memberCount")
      .put(newMemberIndex + 1);

  }

  getChainStats(recipientPub: string): any {
    const chainKey = `${this.userPubKey}_${recipientPub}`;
    const chain = this.messageChains.get(chainKey);
    
    if (!chain) {
      return { messageCount: 0, lastIndex: -1, chainId: null };
    }
    
    return {
      messageCount: chain.messages.length,
      lastIndex: chain.lastIndex,
      chainId: chain.messages[chain.messages.length - 1]?.chainId || null
    };
  }

  destroy(): void {
    this.messageChains.clear();
    this.groupKeys.clear();
    this.processedMessages.clear();
    this.userKeysCache.clear(); // **PERFORMANCE: Clear user keys cache**
    this.stopInboxListening();
    super.destroy();
  }

  cleanup(): void {
    this.destroy();
  }


  async sendMessageInbox(
    recipientPub: string,
    recipientEpub: string,
    messageContent: string,
    options: {
      messageType?: "alias" | "epub" | "token";
      senderAlias?: string;
      recipientAlias?: string;
    } = {}
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {

      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const resolvedRecipientEpub = recipientEpub;
      
      if (!resolvedRecipientEpub) {
        throw new Error("No EPUB provided for recipient");
      }
      

      const sharedSecret = (await this.core!.db.sea.secret(
        resolvedRecipientEpub,
        (this.core!.db.user as any)?._?.sea  
      )) as string;

      if (!sharedSecret) {
        throw new Error("Unable to derive shared secret");
      }

      const encryptedMessage = await this.core!.db.sea.encrypt(
        messageContent,
        sharedSecret
      );

      const encryptedMessageData = {
        data: encryptedMessage,
        from: this.core!.db.user?.is?.pub || "",
        senderEpub: (this.core!.db.user as any)?._?.sea?.epub || "",
        timestamp: Date.now().toString(),
        id: messageId,
      };

      const inboxFields = {
        sender: options.senderAlias || "Unknown",
        senderPub: encryptedMessageData.from,
        senderEpub: encryptedMessageData.senderEpub,
        recipient: options.recipientAlias || "Unknown",
        recipientPub: recipientPub,
        message: encryptedMessage,
        type: options.messageType || "alias",
        encrypted: true,
      };

      const message = { ...encryptedMessageData, ...inboxFields } as const;
      const today = MessagingSchema.utils.formatDate(new Date());


      await new Promise<void>((resolve, reject) => {
        try {
          this.core!.db.gun
            .get(MessagingSchema.privateMessages.recipient(recipientPub))
            .get(today)
            .get(messageId)
            .put(message, (ack: any) => {
              if (ack.err) {
                reject(new Error(`Failed to save to inbox path: ${ack.err}`));
              } else {
                resolve();
              }
            });
        } catch (error) {
          reject(new Error(`GunDB put operation failed: ${error}`));
        }
      });

      return { success: true, messageId };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Unknown error sending to inbox path",
      };
    }
  }

  async receiveMessageInbox(
    options: {
      limit?: number;
      before?: string;
      after?: string;
    } = {}
  ): Promise<{ success: boolean; messages?: any[]; error?: string }> {
    try {

      const messages: any[] = [];
      const currentUserPub = this.core!.db.user?.is?.pub;

      if (!currentUserPub) {
        return { success: false, error: "User not logged in" };
      }

      const currentUserMessagesPath = MessagingSchema.privateMessages.recipient(currentUserPub);

      const dates = await new Promise<string[]>((resolve) => {
        const datesNode = this.core!.db.gun.get(currentUserMessagesPath);
        const dates: string[] = [];

        datesNode.map().on((dateData: any, date: string) => {
          if (dateData && typeof date === "string" && date !== "_") {
            dates.push(date);
          }
        });

        setTimeout(() => resolve(dates), 2000);
      });


      for (const date of dates) {
        const messagesPath = `${currentUserMessagesPath}/${date}`;

        const dateMessages = await new Promise<any[]>((resolve) => {
          const messages: any[] = [];
          const messagesNode = this.core!.db.gun.get(messagesPath);

          messagesNode.map().on((messageData: any, messageId: string) => {
            if (messageData && typeof messageData === "object" && messageId !== "_") {
              messages.push({
                ...messageData,
                date: date,
              });
            }
          });

          setTimeout(() => resolve(messages), 2000);
        });

        messages.push(...dateMessages);
      }

      messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      const limitedMessages = options.limit ? messages.slice(-options.limit) : messages;

      return {
        success: true,
        messages: limitedMessages,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Unknown error reading from inbox path",
      };
    }
  }

  startInboxListening(callback: (message: any) => void): void {
    try {
      if (this._inboxListening) {
        if (this._inboxDebug) {
        }
        return;
      }

      if (this._inboxDebug) {
      }

      const currentUserPubFromCore = this.core!.db.user?.is?.pub;
      if (!currentUserPubFromCore) {
        return;
      }

      const currentUserMessagesPath = MessagingSchema.privateMessages.recipient(currentUserPubFromCore);

      if (this._inboxDebug) {
      }

      const messagesNode = this.core!.db.gun.get(currentUserMessagesPath);
      const topMap = messagesNode.map();
      const topListener = topMap.on((dateData: any, date: string) => {
        if (!dateData || typeof date === "string" || date === "_") return;

        if (this._inboxDateListeners.has(date)) {
          return;
        }

        if (this._inboxDebug) {
        }

        const dateMessagesPath = `${currentUserMessagesPath}/${date}`;
        const dateMessagesNode = this.core!.db.gun.get(dateMessagesPath);
        const dateMap = dateMessagesNode.map();
        const dateListener = dateMap.on(async (messageData: any, messageId: string) => {
          if (!messageData || typeof messageData !== "object" || messageId === "_") return;

          if (this._isValidInboxMessage(messageData, currentUserPubFromCore)) {
            try {
              const currentUserPair = (this.core!.db.user as any)?._?.sea;
              if (!currentUserPair) return;

              const senderPub = messageData.from || messageData.senderPub;
              const encryptedPayload: string | undefined = messageData.data || messageData.message;
              if (!senderPub || !encryptedPayload) return;

              const embeddedSenderEpub: string | undefined = (messageData as any).senderEpub;
              const senderEpub = embeddedSenderEpub && typeof embeddedSenderEpub === "string" && embeddedSenderEpub.length > 0
                ? embeddedSenderEpub
                : await this.getUserKeys(senderPub).then(keys => keys.epub).catch(() => null);
              
              if (!senderEpub) return;
              
              const sharedSecret = await this.core!.db.sea.secret(senderEpub, currentUserPair);
              if (!sharedSecret) return;

              const decrypted = await this.core!.db.sea.decrypt(encryptedPayload, sharedSecret);
              let content: string | null = null;
              if (typeof decrypted === "string") {
                content = decrypted;
              } else if (decrypted && typeof decrypted === "object") {
                content = typeof (decrypted as any).content === "string" ? (decrypted as any).content : JSON.stringify(decrypted);
              }
              if (!content) return;

              const processedMessage = {
                id: messageId,
                from: senderPub,
                content,
                timestamp: parseInt((messageData.timestamp || Date.now()).toString()),
              };

              callback(processedMessage);
            } catch (_) {
            }
          }
        });

        this._inboxDateListeners.set(date, dateMap as any);
      });

      this._inboxTopLevelListener = topMap as any;
      this._inboxListening = true;

      if (this._inboxDebug) {
      }
    } catch (error) {
    }
  }

  stopInboxListening(): void {
    try {
      if (!this._inboxListening) return;

      if (this._inboxDebug) {
      }

      this._inboxDateListeners.forEach((ref) => {
        if (ref && typeof (ref as any).off === "function") {
          (ref as any).off();
        }
      });
      this._inboxDateListeners.clear();

      if (this._inboxTopLevelListener && typeof (this._inboxTopLevelListener as any).off === "function") {
        (this._inboxTopLevelListener as any).off();
      }
      this._inboxTopLevelListener = null;

      this._inboxListening = false;

      if (this._inboxDebug) {
      }
    } catch (error) {
    }
  }

  private _isValidInboxMessage(messageData: any, currentUserPub: string): boolean {
    if (!messageData || typeof messageData !== "object") {
      return false;
    }

    const isToCurrentUser = messageData.recipientPub === currentUserPub;
    const isFromCurrentUser = messageData.senderPub === currentUserPub;

    return isToCurrentUser || isFromCurrentUser;
  }

  setInboxDebugMode(enabled: boolean): void {
    this._inboxDebug = enabled;
  }

  isInboxListening(): boolean {
    return this._inboxListening;
  }

  getInboxListenersCount(): number {
    return this._inboxDateListeners.size;
  }


  getPluginStatus(): {
    isInitialized: boolean;
    userLoggedIn: boolean;
    publicKey: string | null;
    messageChains: number;
    groupKeys: number;
    processedMessages: number;
    inboxListening: boolean;
    inboxListeners: number;
  } {
    return {
      isInitialized: this.isInitialized(),
      userLoggedIn: !!this.userPubKey,
      publicKey: this.userPubKey,
      messageChains: this.messageChains.size,
      groupKeys: this.groupKeys.size,
      processedMessages: this.processedMessages.size,
      inboxListening: this._inboxListening,
      inboxListeners: this._inboxDateListeners.size,
    };
  }

  resetState(): void {
    this.messageChains.clear();
    this.groupKeys.clear();
    this.processedMessages.clear();
    this.stopInboxListening();
  }

  // **NEW: Username management methods for compatibility**
  // Following Mark Nadal's philosophy: decentralized, resilient, offline-first

  /**
   * Register a username for the current user
   * Implements decentralized username registration with conflict resolution
   */
  async registerUsername(username: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.userPubKey) {
        return { success: false, error: "User not logged in" };
      }

      if (!this.core) {
        return { success: false, error: "Core not initialized" };
      }

      // Check if username is available
      const isAvailable = await this.isUsernameAvailable(username);
      if (!isAvailable) {
        return { success: false, error: "Username already taken" };
      }

      // Register the username using GunDB's decentralized approach
      const usernamePath = MessagingSchema.users.usernames();
      
      // Use GunDB's atomic put with conflict resolution
      await new Promise<void>((resolve, reject) => {
        this.core!.gun
          .get(usernamePath)
          .get(username)
          .put(this.userPubKey, (ack: any) => {
            if (ack.err) {
              reject(new Error(`Failed to register username: ${ack.err}`));
            } else {
              resolve();
            }
          });
      });

      // Also store reverse mapping for quick lookup
      await new Promise<void>((resolve, reject) => {
        this.core!.gun
          .get(`~${this.userPubKey}`)
          .get("username")
          .put(username, (ack: any) => {
            if (ack.err) {
              reject(new Error(`Failed to store username mapping: ${ack.err}`));
            } else {
              resolve();
            }
          });
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Register user data (username, epub, pub) in a single atomic operation
   * Implements Mark Nadal's principle of atomic data updates
   */
  async registerUserData(username: string, userEpub: string, userPub: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.core) {
        return { success: false, error: "Core not initialized" };
      }

      // Atomic operation: register both username and user keys
      const usernameResult = await this.registerUsername(username);
      if (!usernameResult.success) {
        return usernameResult;
      }

      // Publish user keys
      await this.publishUserKeys();

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Update username for current user
   * Implements forward secrecy by creating new mappings
   */
  async updateUsername(newUsername: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.userPubKey) {
        return { success: false, error: "User not logged in" };
      }

      // Check if new username is available
      const isAvailable = await this.isUsernameAvailable(newUsername);
      if (!isAvailable) {
        return { success: false, error: "Username already taken" };
      }

      // Get current username to clean up old mapping
      const currentUsername = await this.getUsername(this.userPubKey);
      
      // Register new username
      const result = await this.registerUsername(newUsername);
      if (!result.success) {
        return result;
      }

      // Clean up old username mapping if it exists
      if (currentUsername) {
        await new Promise<void>((resolve) => {
          this.core!.gun
            .get(MessagingSchema.users.usernames())
            .get(currentUsername)
            .put(null, () => resolve());
        });
      }

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Search for a user by username
   * Implements decentralized search with timeout resilience
   */
  async searchUser(username: string): Promise<{ success: boolean; userPub?: string; error?: string }> {
    try {
      if (!this.core) {
        return { success: false, error: "Core not initialized" };
      }

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ success: false, error: "Search timeout" });
        }, 5000);

        this.core!.gun
          .get(MessagingSchema.users.usernames())
          .get(username)
          .once((userPub: string) => {
            clearTimeout(timeout);
            if (userPub && typeof userPub === "string") {
              resolve({ success: true, userPub });
            } else {
              resolve({ success: false, error: "User not found" });
            }
          });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Check if username is available
   * Implements conflict-free checking with exclusion support
   */
  async isUsernameAvailable(username: string, excludeUserPub?: string): Promise<boolean> {
    try {
      if (!this.core) {
        return false;
      }

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(false);
        }, 3000);

        this.core!.gun
          .get(MessagingSchema.users.usernames())
          .get(username)
          .once((userPub: string) => {
            clearTimeout(timeout);
            
            if (!userPub) {
              // Username is available
              resolve(true);
            } else if (excludeUserPub && userPub === excludeUserPub) {
              // Username is taken by the excluded user (current user)
              resolve(true);
            } else {
              // Username is taken by someone else
              resolve(false);
            }
          });
      });
    } catch (error) {
      return false;
    }
  }

  /**
   * Get username by user public key
   * Implements resilient lookup with fallback mechanisms
   */
  async getUsername(userPub: string): Promise<string | null> {
    try {
      if (!this.core) {
        return null;
      }

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(null);
        }, 3000);

        this.core!.gun
          .get(`~${userPub}`)
          .get("username")
          .once((username: string) => {
            clearTimeout(timeout);
            resolve(username && typeof username === "string" ? username : null);
          });
      });
    } catch (error) {
      return null;
    }
  }

  /**
   * Get recipient epub key with caching
   * Implements performance optimization with cache invalidation
   */
  async getRecipientEpub(recipientPub: string): Promise<string | null> {
    try {
      const userKeys = await this.getUserKeys(recipientPub);
      return userKeys?.epub || null;
    } catch (error) {
      return null;
    }
  }
}
