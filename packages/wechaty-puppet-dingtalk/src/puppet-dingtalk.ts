import { AuthCredential } from '@zhengxs/dingtalk-auth';
import {
  HubConnection,
  HubConnectionBuilder,
} from '@zhengxs/dingtalk-event-hubs';
import { GError } from 'gerror';
import * as PUPPET from 'wechaty-puppet';
import { log } from 'wechaty-puppet';

import { type Sayable, SayableSayer } from './dingtalk';
import {
  type DTContactRawPayload,
  dtContactToWechaty,
  type DTMessageRawPayload,
  dtMessageToWechaty,
  type DTRoomRawPayload,
  dtRoomToWechaty,
} from './dingtalk';

export interface PuppetDingTalkOptions extends PUPPET.PuppetOptions {
  clientId?: string;
  clientSecret?: string;
}

export class PuppetDingTalk extends PUPPET.Puppet {
  protected credential: AuthCredential;

  protected connection?: HubConnection;

  protected contacts = new Map<string, DTContactRawPayload>();
  protected messages = new Map<string, DTMessageRawPayload>();
  protected rooms = new Map<string, DTRoomRawPayload>();

  constructor(options: PuppetDingTalkOptions = {}) {
    const {
      clientId = process.env.DINGTALK_CLIENT_ID,
      clientSecret = process.env.DINGTALK_CLIENT_SECRET,
      ...rest
    } = options;

    super(rest);

    this.credential = new AuthCredential({ clientId, clientSecret });
  }

  override async roomRawPayload(roomId: string): Promise<DTRoomRawPayload> {
    const rooms = this.rooms;

    log.verbose(
      'PuppetDingTalk',
      'contactRawPayload(%s) with rooms.length=%d',
      roomId,
      rooms.size,
    );

    const rawPayload = rooms.get(roomId);

    if (!rawPayload) {
      throw new Error(`Room ${roomId} not found`);
    }

    return rawPayload;
  }

  override async roomRawPayloadParser(
    rawPayload: DTRoomRawPayload,
  ): Promise<PUPPET.payloads.Room> {
    return dtRoomToWechaty(this, rawPayload);
  }

  override async contactRawPayload(
    contactId: string,
  ): Promise<DTContactRawPayload> {
    const contacts = this.contacts;

    log.verbose(
      'PuppetDingTalk',
      'contactRawPayload(%s) with contacts.length=%d',
      contactId,
      contacts.size,
    );

    const rawPayload = contacts.get(contactId);

    if (!rawPayload) {
      throw new Error(`Contacts ${contactId} not found`);
    }

    return rawPayload;
  }

  override async contactRawPayloadParser(
    rawPayload: DTContactRawPayload,
  ): Promise<PUPPET.payloads.Contact> {
    return dtContactToWechaty(this, rawPayload);
  }

  override async messageRawPayload(
    messageId: string,
  ): Promise<DTMessageRawPayload> {
    const messages = this.messages;

    log.info(
      'PuppetDingTalk',
      'messageRawPayload(%s) with messages.length=%d',
      messageId,
      messages.size,
    );

    const rawPayload = messages.get(messageId);

    if (!rawPayload) {
      throw new Error(`Message ${messageId} not found`);
    }

    return rawPayload;
  }

  override async messageRawPayloadParser(
    rawPayload: DTMessageRawPayload,
  ): Promise<PUPPET.payloads.Message> {
    log.verbose(
      'PuppetDingTalk',
      'messageRawPayloadParser(%s) @ %s',
      rawPayload,
      this,
    );

    return dtMessageToWechaty(this, rawPayload);
  }

  protected async send(
    conversationId: string,
    Sayable: Sayable,
    mentionIdList?: string[],
  ): Promise<void> {
    const contacts = this.contacts;
    const rooms = this.rooms;

    const payload = contacts.get(conversationId) || rooms.get(conversationId);
    if (!payload) return;

    const sayer = new SayableSayer(
      payload.sessionWebhook,
      payload.sessionWebhookExpiredTime,
    );

    await sayer.say(Sayable, mentionIdList || []);
  }

  override messageSendText(
    conversationId: string, // TODO 群或联系人ID?
    content: string,
    mentionIdList?: string[],
  ): Promise<void> {
    log.verbose(
      'PuppetDingTalk',
      'messageSend(%s, %s)',
      conversationId,
      content,
    );

    return this.send(conversationId, content, mentionIdList || []);
  }

  override messageSendUrl(
    conversationId: string,
    urlLinkPayload: PUPPET.payloads.UrlLink,
  ) {
    log.verbose(
      'PuppetDingTalk',
      'messageSendUrl(%s, %s)',
      conversationId,
      urlLinkPayload,
    );

    return this.send(conversationId, {
      msgtype: 'link',
      link: {
        title: urlLinkPayload.title,
        text: urlLinkPayload.description || '',
        messageUrl: urlLinkPayload.url,
        picUrl: urlLinkPayload.thumbnailUrl || '',
      },
    });
  }

  override async onStart(): Promise<void> {
    log.verbose(
      'PuppetDingTalk',
      'onStart() with %s',
      this.memory.name || 'NONAME',
    );

    const connection = new HubConnectionBuilder()
      .withCredential(this.credential)
      .build();

    const rooms = this.rooms;
    const contacts = this.contacts;
    const messages = this.messages;

    connection.on('message', async event => {
      const payload: DTMessageRawPayload = JSON.parse(event.data);

      const { sessionWebhook, sessionWebhookExpiredTime } = payload;

      // TODO 这么提前获取机器人的信息
      if (!this.isLoggedIn) {
        const { chatbotUserId, robotCode, chatbotCorpId } = payload;

        contacts.set(chatbotUserId, {
          senderNick: `🤖️ 默认`,
          senderId: chatbotUserId,
          senderStaffId: robotCode,
          senderCorpId: chatbotCorpId,
          isAdmin: false,
          // hack 解决 wechaty 发送消息不会传消息 ID 的问题
          sessionWebhook,
          sessionWebhookExpiredTime,
        });

        await this.login(payload.chatbotUserId);
      }

      const { senderCorpId, senderId, senderNick, senderStaffId, isAdmin } =
        payload;

      contacts.set(senderId, {
        senderCorpId,
        senderId,
        senderNick,
        senderStaffId,
        isAdmin,
        // hack 解决 wechaty 发送消息不会传消息 ID 的问题
        sessionWebhook,
        sessionWebhookExpiredTime,
      });

      if (payload.conversationType === '2') {
        const { conversationId, conversationTitle } = payload;

        rooms.set(conversationId, {
          conversationId,
          conversationTitle,
          // hack 解决 wechaty 发送消息不会传消息 ID 的问题
          sessionWebhook,
          sessionWebhookExpiredTime,
        });
      }

      const messageId = payload.msgId;

      messages.set(messageId, payload);

      this.emit('message', { messageId });
    });

    const waitStable = () => {
      log.verbose('PuppetDingTalk', 'readyStable() emit(ready)');
      this.emit('ready', { data: 'stable' });
    };

    connection.on('reconnected', waitStable);
    connection.on('connected', waitStable);

    connection.on('disconnected', () => {
      if (this.isLoggedIn) this.logout();
    });

    connection.on('error', (err: Error) => {
      this.emit('error', {
        data: GError.stringify(err),
      });
    });

    await connection.start();

    this.connection = connection;
  }

  override async onStop(): Promise<void> {
    if (this.connection) {
      this.connection.close(true, true);
      this.connection = undefined;
    }
  }
}
