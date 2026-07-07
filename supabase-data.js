import { supabase, isSupabaseConfigured } from './supabase.js';

function assertConfigured() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase ist nicht konfiguriert.');
  }
}

function isMissingRpc(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('could not find the function') || message.includes('does not exist');
}

function mapBookingRow(row) {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    serviceId: row.service_id,
    serviceName: row.service_name,
    durationMin: row.duration_min,
    priceFrom: Number(row.price_from || 0),
    deposit: Number(row.deposit || 0),
    stylistId: row.stylist_id,
    stylistName: row.stylist_name,
    dateISO: row.date_iso,
    time: row.time,
    customer: row.customer || {},
    depositPaid: Boolean(row.deposit_paid),
    paymentStatus: row.payment_status || (row.deposit_paid ? 'paid' : 'unpaid'),
    paymentProvider: row.payment_provider || null,
    paymentReference: row.payment_reference || null,
    stripeCheckoutSessionId: row.stripe_checkout_session_id || null,
    stripePaymentIntentId: row.stripe_payment_intent_id || null,
    paymentReceiptUrl: row.payment_receipt_url || null,
    paidAt: row.paid_at || null
  };
}

function mapWaitlistRow(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    serviceId: row.service_id,
    serviceName: row.service_name,
    email: row.email,
    phone: row.phone,
    note: row.note || ''
  };
}

function mapRole(value) {
  if (value === 'staff' || value === 'admin') return value;
  return 'customer';
}

function mapProfileRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    role: mapRole(row.role),
    fullName: row.full_name || '',
    phone: row.phone || '',
    address: row.address || '',
    avatarUrl: row.avatar_url || '',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

export async function getCurrentUser() {
  assertConfigured();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user || null;
}

export async function getCurrentUserRole() {
  assertConfigured();
  const syncResult = await supabase.rpc('sync_my_role_from_email');
  if (!syncResult.error) {
    return mapRole(syncResult.data);
  }
  if (!isMissingRpc(syncResult.error)) {
    const message = String(syncResult.error?.message || '').toLowerCase();
    if (!message.includes('auth_required')) {
      throw syncResult.error;
    }
  }

  const fallback = await supabase.rpc('current_user_role');
  if (fallback.error) {
    if (isMissingRpc(fallback.error)) return 'customer';
    throw fallback.error;
  }
  return mapRole(fallback.data);
}

export async function getMyProfile() {
  assertConfigured();
  const user = await getCurrentUser();
  if (!user?.id) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return {
      id: user.id,
      role: 'customer',
      fullName: '',
      phone: '',
      address: '',
      avatarUrl: '',
      createdAt: null,
      updatedAt: null
    };
  }
  return mapProfileRow(data);
}

export async function saveMyProfile(profile) {
  assertConfigured();
  const user = await getCurrentUser();
  if (!user?.id) throw new Error('AUTH_REQUIRED');

  const payload = {
    id: user.id,
    full_name: String(profile?.fullName || '').trim() || null,
    phone: String(profile?.phone || '').trim() || null,
    address: String(profile?.address || '').trim() || null,
    avatar_url: String(profile?.avatarUrl || '').trim() || null
  };

  const { data, error } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select('*')
    .single();
  if (error) throw error;
  return mapProfileRow(data);
}

export async function adminSetUserRoleByEmail(email, role) {
  assertConfigured();
  const normalizedEmail = String(email || '').trim();
  const normalizedRole = mapRole(role);
  if (!normalizedEmail) throw new Error('E-Mail fehlt.');

  const { data, error } = await supabase.rpc('admin_set_user_role_by_email', {
    p_email: normalizedEmail,
    p_role: normalizedRole
  });
  if (error) throw error;
  const row = Array.isArray(data) ? (data[0] || null) : (data || null);
  if (!row) return null;
  return {
    userId: row.user_id || null,
    email: row.email || normalizedEmail.toLowerCase(),
    role: mapRole(row.role)
  };
}

export async function adminListUsersWithRoles(limitRows = 120) {
  assertConfigured();
  const { data, error } = await supabase.rpc('admin_list_users_with_roles', {
    p_limit_rows: limitRows
  });
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.user_id,
    email: row.email || '',
    role: mapRole(row.role),
    fullName: row.full_name || '',
    phone: row.phone || '',
    address: row.address || '',
    avatarUrl: row.avatar_url || '',
    createdAt: row.created_at || null
  }));
}

export async function getMyBookings() {
  assertConfigured();
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapBookingRow);
}

export async function getMyBookingById(id) {
  assertConfigured();
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapBookingRow(data) : null;
}

export async function createMyBooking(model, userId) {
  assertConfigured();
  if (!userId) throw new Error('Kein User gefunden.');
  const payload = {
    p_service_id: model.serviceId,
    p_service_name: model.serviceName,
    p_duration_min: model.durationMin,
    p_price_from: model.priceFrom || 0,
    p_deposit: model.deposit || 0,
    p_stylist_id: model.stylistId || 'auto',
    p_stylist_name: model.stylistName || 'Egal (automatisch)',
    p_date_iso: model.dateISO,
    p_time: model.time,
    p_customer: model.customer || {},
    p_deposit_paid: Boolean(model.depositPaid)
  };
  const { data, error } = await supabase.rpc('create_booking_secure', payload);
  if (!error) return mapBookingRow(data);
  if (!isMissingRpc(error)) throw error;

  const fallbackPayload = {
    user_id: userId,
    status: model.status || 'requested',
    service_id: model.serviceId,
    service_name: model.serviceName,
    duration_min: model.durationMin,
    price_from: model.priceFrom || 0,
    deposit: model.deposit || 0,
    stylist_id: model.stylistId || 'auto',
    stylist_name: model.stylistName || 'Egal (automatisch)',
    date_iso: model.dateISO,
    time: model.time,
    customer: model.customer || {},
    deposit_paid: Boolean(model.depositPaid),
    payment_status: model.paymentStatus || (model.depositPaid ? 'paid' : 'unpaid'),
    payment_provider: model.paymentProvider || null,
    payment_reference: model.paymentReference || null
  };
  const fallback = await supabase
    .from('bookings')
    .insert(fallbackPayload)
    .select('*')
    .single();
  if (fallback.error) throw fallback.error;
  return mapBookingRow(fallback.data);
}

export async function updateBookingStatus(id, status) {
  assertConfigured();
  const { data, error } = await supabase.rpc('set_booking_status', {
    p_booking_id: id,
    p_status: status
  });
  if (!error) return mapBookingRow(data);
  if (!isMissingRpc(error)) throw error;

  const fallback = await supabase
    .from('bookings')
    .update({ status })
    .eq('id', id)
    .select('*')
    .single();
  if (fallback.error) throw fallback.error;
  return mapBookingRow(fallback.data);
}

export async function cancelMyBooking(id) {
  assertConfigured();
  const { data, error } = await supabase.rpc('cancel_my_booking', {
    p_booking_id: id
  });
  if (!error) return mapBookingRow(data);
  if (!isMissingRpc(error)) throw error;

  const fallback = await supabase
    .from('bookings')
    .update({ status: 'canceled' })
    .eq('id', id)
    .select('*')
    .single();
  if (fallback.error) throw fallback.error;
  return mapBookingRow(fallback.data);
}

export async function clearMyBookings(userId) {
  assertConfigured();
  if (!userId) throw new Error('Kein User gefunden.');
  const { error } = await supabase
    .from('bookings')
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
}

export async function getMyWaitlist() {
  assertConfigured();
  const { data, error } = await supabase
    .from('waitlist')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapWaitlistRow);
}

export async function createMyWaitlistEntry(model, userId) {
  assertConfigured();
  if (!userId) throw new Error('Kein User gefunden.');
  const payload = {
    user_id: userId,
    service_id: model.serviceId,
    service_name: model.serviceName,
    email: model.email,
    phone: model.phone,
    note: model.note || ''
  };
  const { data, error } = await supabase
    .from('waitlist')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return mapWaitlistRow(data);
}

export async function removeMyWaitlistEntry(id) {
  assertConfigured();
  const { error } = await supabase
    .from('waitlist')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function clearMyWaitlist(userId) {
  assertConfigured();
  if (!userId) throw new Error('Kein User gefunden.');
  const { error } = await supabase
    .from('waitlist')
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
}

export async function checkSlotAvailability({ dateISO, time, durationMin, stylistId = 'auto', excludeBookingId = null }) {
  assertConfigured();
  const { data, error } = await supabase.rpc('slot_is_available', {
    p_date_iso: dateISO,
    p_time: time,
    p_duration_min: durationMin,
    p_stylist_id: stylistId,
    p_exclude_booking_id: excludeBookingId
  });
  if (error) throw error;
  return Boolean(data);
}
