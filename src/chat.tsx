import React, { useState } from "react";
import { ItemContent, Virtuoso } from "react-virtuoso";
import cn from "clsx";
import { gql, useQuery, useMutation, useSubscription } from "@apollo/client";
import {
  Message,
  MessageSender,
  MessageStatus,
} from "../__generated__/resolvers-types";
import css from "./chat.module.css";

// Типы данных для GraphQL операций
interface MessagesData {
  messages: {
    edges: Array<{ node: Message; cursor: string }>;
    pageInfo: { endCursor: string; hasNextPage: boolean };
  };
}

// GraphQL запросы
const GET_MESSAGES = gql`
  query GetMessages($first: Int, $after: MessagesCursor) {
    messages(first: $first, after: $after) {
      edges {
        node {
          id text status updatedAt sender
        }
        cursor
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

const SEND_MESSAGE = gql`
  mutation SendMessage($text: String!) {
    sendMessage(text: $text) {
      id text status updatedAt sender
    }
  }
`;

const MESSAGE_ADDED = gql`
  subscription OnMessageAdded {
    messageAdded {
      id text status updatedAt sender
    }
  }
`;

const MESSAGE_UPDATED = gql`
  subscription OnMessageUpdated {
    messageUpdated {
      id text status updatedAt sender
    }
  }
`;

// Компонент для отображения одного сообщения
const MessageItem: React.FC<Message> = ({ text, sender, status }) => (
  <div className={css.item}>
    <div className={cn(css.message, sender === MessageSender.Admin ? css.out : css.in)}>
      {text}
      {status === MessageStatus.Sending && " (sending...)"}
      {status === MessageStatus.Read && " ✓✓"}
      {status === MessageStatus.Sent && " ✓"}
    </div>
  </div>
);

const MESSAGES_PER_PAGE = 20;

export const Chat: React.FC = () => {
  const [inputText, setInputText] = useState("");

  // Получение сообщений с пагинацией
  const { data, loading, error, fetchMore } = useQuery<MessagesData>(GET_MESSAGES, {
    variables: { first: MESSAGES_PER_PAGE },
  });

  // Мутация для отправки сообщения
  const [sendMessage] = useMutation(SEND_MESSAGE);

  // Подписка на новые сообщения
  useSubscription(MESSAGE_ADDED, {
    onData: ({ client, data }) => {
      if (!data.data?.messageAdded) return;

      const existing = client.cache.readQuery<MessagesData>({
        query: GET_MESSAGES,
        variables: { first: MESSAGES_PER_PAGE }
      });

      if (!existing) return;

      // Проверяем, не устарело ли новое сообщение
      const existingMessage = existing.messages.edges.find(
        edge => edge.node.id === data.data.messageAdded.id
      );

      if (existingMessage && 
          new Date(existingMessage.node.updatedAt) > new Date(data.data.messageAdded.updatedAt)) {
        return;
      }

      // Обновляем кэш с новым сообщением
      client.cache.writeQuery({
        query: GET_MESSAGES,
        variables: { first: MESSAGES_PER_PAGE },
        data: {
          messages: {
            ...existing.messages,
            edges: [
              ...existing.messages.edges.filter(edge => edge.node.id !== data.data.messageAdded.id),
              {
                __typename: "MessageEdge",
                node: data.data.messageAdded,
                cursor: data.data.messageAdded.id
              }
            ]
          }
        }
      });
    }
  });

  // Подписка на обновления статусов сообщений
  useSubscription(MESSAGE_UPDATED, {
    onData: ({ client, data }) => {
      if (!data.data?.messageUpdated) return;
      
      client.cache.modify({
        id: client.cache.identify({
          __typename: 'Message',
          id: data.data.messageUpdated.id,
          sender: data.data.messageUpdated.sender
        }),
        fields: {
          status: () => data.data.messageUpdated.status,
          updatedAt: () => data.data.messageUpdated.updatedAt
        }
      });
    }
  });

  // Обработчик подгрузки следующих сообщений
  const handleLoadMore = () => {
    if (data?.messages.pageInfo.hasNextPage) {
      fetchMore({
        variables: {
          after: data.messages.pageInfo.endCursor,
          first: MESSAGES_PER_PAGE
        },
        updateQuery: (prev, { fetchMoreResult }) => {
          if (!fetchMoreResult) return prev;
          
          return {
            messages: {
              __typename: "MessagePage",
              // Объединяем предыдущие сообщения с новыми
              edges: [...prev.messages.edges, ...fetchMoreResult.messages.edges],
              // Обновляем информацию о пагинации
              pageInfo: fetchMoreResult.messages.pageInfo
            }
          };
        }
      });
    }
  };

  // Обработчик отправки сообщения
  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    try {
      setInputText("");
      await sendMessage({ variables: { text: inputText } });
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  if (error) return <div>Error loading messages</div>;

  return (
    <div className={css.root}>
      <div className={css.container}>
        <Virtuoso 
          className={css.list} 
          data={data?.messages.edges.map(edge => edge.node) || []} 
          itemContent={(_, data) => <MessageItem {...data} />}
          endReached={handleLoadMore}
          followOutput="auto"
        />
      </div>
      <div className={css.footer}>
        <input
          type="text"
          disabled={loading}
          className={css.textInput}
          placeholder="Message text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
        />
        <button disabled={loading} onClick={handleSendMessage}>Send</button>
      </div>
    </div>
  );
};