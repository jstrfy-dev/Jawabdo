import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';

const CloudDataContext = createContext(null);
const emptyData = { dashboard: null, bookings: [], customers: [], conversations: [], connection: null, databaseDriver: 'server' };

function displayBookingStatus(status) {
  if (status === 'pending_confirmation') return 'Pending';
  return status ? status[0].toUpperCase() + status.slice(1) : 'Pending';
}

function mapBooking(booking) {
  return {
    ...booking,
    customerId: booking.customer_id,
    customer: booking.customer_name || '',
    service: booking.service_name || '',
    amount: Number(booking.price_minor || 0) / 100,
    at: booking.starts_at,
    status: displayBookingStatus(booking.status),
    rawStatus: booking.status,
    staff: booking.staff_key || 'default',
  };
}

function mapCustomer(customer) {
  return {
    ...customer,
    name: customer.display_name || 'Customer',
    phone: customer.phone_number || '',
    tags: Array.isArray(customer.tags) ? customer.tags : [],
    visits: Number(customer.visits || 0),
    spent: Number(customer.spent_minor || 0) / 100,
    lastVisit: customer.last_visit,
  };
}

function mapConversation(conversation) {
  const states = {
    needs_owner: 'Flagged',
    owner_handling: 'Owner handling',
    closed: 'Closed',
    ai: 'Open',
  };
  return {
    ...conversation,
    customerId: conversation.customer_id,
    name: conversation.display_name || 'Customer',
    last: conversation.last_message || 'No messages yet.',
    at: conversation.last_message_at,
    state: states[conversation.state] || 'AI replied',
    messages: [],
  };
}

function mapMessage(message) {
  const senders = { customer: 'them', assistant: 'ai', owner: 'owner', system: 'ai' };
  return {
    id: message.id,
    from: senders[message.sender] || 'them',
    text: message.body,
    at: message.created_at,
    deliveryStatus: message.delivery_status,
  };
}

export function CloudDataProvider({ children }) {
  const { session, api } = useAuth();
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(Boolean(session?.accessToken));
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!session?.accessToken) {
      setData(emptyData);
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [dashboardResult, bookingsResult, customersResult, conversationsResult, connectionResult, publicConfig] = await Promise.all([
        api.getDashboard(session.accessToken),
        api.getBookings(session.accessToken),
        api.getCustomers(session.accessToken),
        api.getConversations(session.accessToken),
        api.getWhatsAppConnection(session.accessToken),
        api.publicConfig(),
      ]);
      setData({
        dashboard: dashboardResult.dashboard,
        bookings: (bookingsResult.bookings || []).map(mapBooking),
        customers: (customersResult.customers || []).map(mapCustomer),
        conversations: (conversationsResult.conversations || []).map(mapConversation),
        connection: connectionResult.connection,
        databaseDriver: publicConfig.databaseDriver || 'server',
      });
    } catch (requestError) {
      setData(emptyData);
      setError(requestError.message || 'Live business data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [api, session?.accessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const getConversationMessages = useCallback(async (conversationId) => {
    const result = await api.getConversationMessages(session.accessToken, conversationId);
    return (result.messages || []).map(mapMessage);
  }, [api, session?.accessToken]);

  const setConversationState = useCallback(async (conversationId, state) => {
    await api.setConversationState(session.accessToken, conversationId, state);
    setData((current) => ({
      ...current,
      conversations: current.conversations.map((item) => item.id === conversationId
        ? mapConversation({ ...item, state })
        : item),
    }));
  }, [api, session?.accessToken]);

  const updateBookingStatus = useCallback(async (bookingId, status) => {
    await api.updateBooking(session.accessToken, bookingId, status);
    setData((current) => ({
      ...current,
      bookings: current.bookings.map((booking) => booking.id === bookingId
        ? { ...booking, status: displayBookingStatus(status), rawStatus: status }
        : booking),
    }));
  }, [api, session?.accessToken]);

  const getCustomer = useCallback(async (customerId) => {
    const result = await api.getCustomer(session.accessToken, customerId);
    return { customer: mapCustomer(result.customer), bookings: (result.bookings || []).map(mapBooking) };
  }, [api, session?.accessToken]);

  const updateCustomer = useCallback(async (customerId, customer) => {
    const result = await api.updateCustomer(session.accessToken, customerId, customer);
    setData((current) => ({
      ...current,
      customers: current.customers.map((item) => item.id === customerId
        ? mapCustomer({ ...item, ...result.customer })
        : item),
    }));
    return result.customer;
  }, [api, session?.accessToken]);

  const value = useMemo(() => ({
    ...data,
    loading,
    error,
    refresh,
    getConversationMessages,
    setConversationState,
    updateBookingStatus,
    getCustomer,
    updateCustomer,
  }), [data, loading, error, refresh, getConversationMessages, setConversationState, updateBookingStatus, getCustomer, updateCustomer]);

  return <CloudDataContext.Provider value={value}>{children}</CloudDataContext.Provider>;
}

export function useCloudData() {
  const value = useContext(CloudDataContext);
  if (!value) throw new Error('useCloudData must be used inside CloudDataProvider.');
  return value;
}
