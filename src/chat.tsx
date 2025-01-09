import React, { useState } from "react";
import { ItemContent, Virtuoso } from "react-virtuoso";
import cn from "clsx";
import { gql, useQuery, useMutation, useSubscription } from "@apollo/client";
import {
  MessageSender,
  MessageStatus,
  type Message,
} from "../__generated__/resolvers-types";
import css from "./chat.module.css";

// GraphQL Operations
const GET_MESSAGES = gql`
  query GetMessages($first: Int, $after: MessagesCursor) {
    messages(first: $first, after: $after) {
      edges {
        node {
          id
          text
          status
          updatedAt
          sender
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
      id
      text
      status
      updatedAt
      sender
    }
  }
`;

const MESSAGE_ADDED = gql`
  subscription OnMessageAdded {
    messageAdded {
      id
      text
      status
      updatedAt
      sender
    }
  }
`;

const MESSAGE_UPDATED = gql`
  subscription OnMessageUpdated {
    messageUpdated {
      id
      text
      status
      updatedAt
      sender
    }
  }
`;

const Item: React.FC<Message> = ({ text, sender, status }) => {
  return (
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
};

const getItem: ItemContent<Message, unknown> = (_, data) => {
  return <Item {...data} />;
};

export const Chat: React.FC = () => {
  const [inputText, setInputText] = useState("");
  
  // Query for fetching messages with pagination
  const { data, loading, error, fetchMore } = useQuery<MessagesData>(GET_MESSAGES, {
    variables: { first: 20 },
  });

  // Mutation for sending messages
  const [sendMessage] = useMutation(SEND_MESSAGE, {
    optimisticResponse: ({ text }) => ({
      sendMessage: {
        __typename: "Message",
        id: `temp-${Date.now()}`,
        text,
        status: MessageStatus.Sending,
        updatedAt: new Date().toISOString(),
        sender: MessageSender.Admin,
      }
    }),
    update(cache, { data: { sendMessage: newMessage } }) {
      const existing = cache.readQuery<MessagesData>({ 
        query: GET_MESSAGES,
        variables: { first: 20 }
      });
      
      if (!existing) return;

      // Check if message already exists in cache
      const exists = existing.messages.edges.some(
        (edge: Edge) => edge.node.id === newMessage.id
      );
      
      if (!exists) {
        cache.writeQuery({
          query: GET_MESSAGES,
          variables: { first: 20 },
          data: {
            messages: {
              ...existing.messages,
              edges: [
                ...existing.messages.edges,
                { 
                  __typename: "MessageEdge",
                  node: newMessage,
                  cursor: newMessage.id 
                }
              ]
            }
          }
        });
      }
    }
  });

  // Subscription for new messages
  useSubscription(MESSAGE_ADDED, {
    onData: ({ client, data }) => {
      const newMessage = data.data.messageAdded;
      
      const existing = client.cache.readQuery<MessagesData>({
        query: GET_MESSAGES,
        variables: { first: 20 }
      });
      
      if (!existing) return;

      // Check if message already exists (including temp messages)
      const exists = existing.messages.edges.some(
        (edge: Edge) => 
          edge.node.id === newMessage.id || 
          (edge.node.text === newMessage.text && 
           edge.node.sender === newMessage.sender &&
           edge.node.id.startsWith('temp-'))
      );
      
      if (!exists) {
        client.cache.writeQuery({
          query: GET_MESSAGES,
          variables: { first: 20 },
          data: {
            messages: {
              ...existing.messages,
              edges: [
                ...existing.messages.edges.filter(
                  edge => !edge.node.id.startsWith('temp-') || 
                         edge.node.text !== newMessage.text || 
                         edge.node.sender !== newMessage.sender
                ),
                { 
                  __typename: "MessageEdge",
                  node: newMessage,
                  cursor: newMessage.id 
                }
              ]
            }
          }
        });
      }
    }
  });

  // Subscription for message updates
  useSubscription(MESSAGE_UPDATED, {
    onData: ({ client, data }) => {
      const updatedMessage = data.data.messageUpdated;
      
      // Update the specific message in cache
      client.cache.modify({
        id: client.cache.identify({ __typename: 'Message', id: updatedMessage.id }),
        fields: {
          status: () => updatedMessage.status,
          updatedAt: () => updatedMessage.updatedAt
        }
      });
    }
  });

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    
    try {
      setInputText("");
      await sendMessage({ variables: { text: inputText } });
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  const handleLoadMore = () => {
    if (data?.messages.pageInfo.hasNextPage) {
      fetchMore({
        variables: {
          after: data.messages.pageInfo.endCursor,
          first: 20
        },
        updateQuery: (prev, { fetchMoreResult }) => {
          if (!fetchMoreResult) return prev;
          return {
            messages: {
              ...fetchMoreResult.messages,
              edges: [
                ...prev.messages.edges,
                ...fetchMoreResult.messages.edges
              ]
            }
          };
        }
      });
    }
  };

  if (error) return <div>Error loading messages</div>;

  interface Edge {
  node: Message;
  cursor: string;
}

interface PageInfo {
  endCursor: string | null;
  hasNextPage: boolean;
}

interface MessagesData {
  messages: {
    edges: Edge[];
    pageInfo: PageInfo;
  };
}

const messages = data?.messages.edges.map((edge: Edge) => edge.node) || [];

  return (
    <div className={css.root}>
      <div className={css.container}>
        <Virtuoso 
          className={css.list} 
          data={messages} 
          itemContent={getItem}
          endReached={handleLoadMore}
          followOutput="auto"
        />
      </div>
      <div className={css.footer}>
        <input
          type="text"
          className={css.textInput}
          placeholder="Message text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
        />
        <button onClick={handleSendMessage}>Send</button>
      </div>
    </div>
  );
};