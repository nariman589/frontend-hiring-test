import React, { useState } from "react";
import { Virtuoso } from "react-virtuoso";
import cn from "clsx";
import {
  useQuery,
  useMutation,
  useSubscription,
  useApolloClient,
} from "@apollo/client";
import {
  Message,
  MessageSender,
  MessageStatus,
} from "../__generated__/resolvers-types";
import css from "./chat.module.css";
import {
  GET_MESSAGES,
  SEND_MESSAGE,
  MESSAGE_ADDED,
  MESSAGE_UPDATED,
} from "./graphql/requests";

// Типы данных для GraphQL операций
interface MessagesData {
  messages: {
    edges: Array<{ node: Message; cursor: string }>;
    pageInfo: { endCursor: string; hasNextPage: boolean };
  };
}

// Компонент для отображения одного сообщения
const MessageItem: React.FC<Message> = ({ text, sender, status }) => (
  <div className={css.item}>
    <div
      className={cn(
        css.message,
        sender === MessageSender.Admin ? css.out : css.in
      )}
    >
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
  const { data, loading, error, fetchMore } = useQuery<MessagesData>(
    GET_MESSAGES,
    {
      variables: { first: MESSAGES_PER_PAGE },
    }
  );

  const client = useApolloClient();

  // Мутация для отправки сообщения
  const [sendMessage] = useMutation(SEND_MESSAGE, {
    onQueryUpdated(observableQuery, { result }) {
      // Получаем предыдущие данные
      const previousData = observableQuery.getCurrentResult().data;
      if (!previousData?.messages?.edges || !result?.messages?.edges)
        return false;

      // Получаем актуальное сообщение
      const newMessages: Array<{ node: Message; cursor: string }> =
        result.messages.edges;
      const oldMessages: Array<{ node: Message; cursor: string }> =
        previousData.messages.edges;

      // Находим изменившиеся сообщения
      const changedMessages = oldMessages.filter(
        (oldMsg) =>
          !newMessages.find(
            (newMsg) =>
              newMsg.node.id === oldMsg.node.id &&
              newMsg.node.updatedAt === oldMsg.node.updatedAt
          )
      );

      // Если изменений нет - не обновляем
      if (changedMessages.length === 0) return false;

      setTimeout(() => {
        client.writeQuery({
          query: GET_MESSAGES,
          variables: { first: MESSAGES_PER_PAGE },
          data: {
            messages: {
              ...previousData.messages,
              edges: [
                ...newMessages.filter(
                  (oldMsg) =>
                    !changedMessages.find(
                      (changed) => changed.node.id === oldMsg.node.id
                    )
                ),
                ...changedMessages,
              ],
            },
          },
        });
      }, 50);

      return false; // Не разрешаем автоматическое обновление
    },
  });

  // Подписка на новые сообщения
  useSubscription(MESSAGE_ADDED, {
    onData: ({ client, data }) => {
      if (!data.data?.messageAdded) return;

      const existing = client.cache.readQuery<MessagesData>({
        query: GET_MESSAGES,
        variables: { first: MESSAGES_PER_PAGE },
      });

      if (!existing) return;

      // Проверяем, не устарело ли новое сообщение
      const existingMessage = existing.messages.edges.find(
        (edge) => edge.node.id === data.data.messageAdded.id
      );

      if (
        existingMessage &&
        existingMessage.node.updatedAt > data.data.updatedAt
      ) {
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
              ...existing.messages.edges.filter(
                (edge) => edge.node.id !== data.data.messageAdded.id
              ),
              {
                __typename: "MessageEdge",
                node: data.data.messageAdded,
                cursor: data.data.messageAdded.id,
              },
            ],
          },
        },
      });
    },
  });

  // Подписка на обновления статусов сообщений
  useSubscription(MESSAGE_UPDATED, {
    onData: ({ client, data }) => {
      if (!data.data?.messageUpdated) return;

      client.cache.modify({
        id: client.cache.identify({
          __typename: "Message",
          id: data.data.messageUpdated.id,
        }),
        fields: {
          status: () => data.data.messageUpdated.status,
          updatedAt: () => data.data.messageUpdated.updatedAt,
        },
      });
    },
  });

  // Обработчик подгрузки следующих сообщений
  const handleLoadMore = () => {
    if (data?.messages.pageInfo.hasNextPage) {
      fetchMore({
        variables: {
          after: data.messages.pageInfo.endCursor,
          first: MESSAGES_PER_PAGE,
        },
        updateQuery: (prev, { fetchMoreResult }) => {
          if (!fetchMoreResult) return prev;

          return {
            messages: {
              __typename: "MessagePage",
              // Объединяем предыдущие сообщения с новыми
              edges: [
                ...prev.messages.edges,
                ...fetchMoreResult.messages.edges,
              ],
              // Обновляем информацию о пагинации
              pageInfo: fetchMoreResult.messages.pageInfo,
            },
          };
        },
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
          data={data?.messages.edges.map((edge) => edge.node) || []}
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
          onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
        />
        <button disabled={loading} onClick={handleSendMessage}>
          Send
        </button>
      </div>
    </div>
  );
};
