-- Script para crear chat de prueba con TODOS los tipos de mensajes
-- Ejecutar desde terminal: cd /tmp && sudo -u postgres psql -d contactcenter_crm -f /tmp/insertar-chat-prueba.sql

-- Generar IDs únicos para los mensajes
\set msg_id_base '''test-msg-'''
\set conv_id '''test-conversation-demo'''

-- 1. Crear conversación de prueba
INSERT INTO crm_conversations (
  id,
  phone,
  contact_name,
  status,
  unread,
  last_message_preview,
  last_message_at,
  channel
) VALUES (
  'test-conversation-demo',
  '+51987654321',
  'Cliente Demo - Prueba Completa',
  'assigned',
  0,
  'Conversación de prueba con todos los tipos de mensajes',
  EXTRACT(EPOCH FROM NOW())::bigint * 1000,
  'whatsapp'
) ON CONFLICT (id) DO UPDATE SET
  last_message_preview = EXCLUDED.last_message_preview,
  last_message_at = EXCLUDED.last_message_at;

-- 2. Mensajes del cliente (incoming) - TEXTO SIMPLE
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, sent_by) VALUES
('test-msg-001', 'test-conversation-demo', 'in', 'text', 'Hola, buenos días! 👋', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '30 minutes'))::bigint * 1000), 'Cliente Demo'),
('test-msg-002', 'test-conversation-demo', 'in', 'text', 'Quisiera información sobre zapatillas Azaleia', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '29 minutes'))::bigint * 1000), 'Cliente Demo'),
('test-msg-003', 'test-conversation-demo', 'in', 'text', 'Tienen modelos deportivos?', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '28 minutes'))::bigint * 1000), 'Cliente Demo');

-- 3. Respuesta del bot (outgoing)
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, sent_by) VALUES
('test-msg-004', 'test-conversation-demo', 'out', 'text', '¡Hola! Bienvenido a Azaleia 😊\n\nSí, tenemos una amplia variedad de zapatillas deportivas. ¿Te gustaría ver nuestro catálogo?', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '27 minutes'))::bigint * 1000), 'Bot Azaleia');

-- 4. Mensaje con botones interactivos
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, sent_by, metadata) VALUES
('test-msg-005', 'test-conversation-demo', 'out', 'interactive', 'Selecciona una opción:', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '26 minutes'))::bigint * 1000), 'Bot Azaleia',
'{"interactive_type":"button","buttons":[{"id":"cat","text":"Ver Catálogo 📸"},{"id":"asesor","text":"Hablar con Asesor 👤"},{"id":"horario","text":"Horarios 🕐"}]}');

-- 5. Cliente selecciona botón
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, sent_by) VALUES
('test-msg-006', 'test-conversation-demo', 'in', 'text', 'Hablar con Asesor 👤', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '25 minutes'))::bigint * 1000), 'Cliente Demo');

-- 6. MENSAJE DEL SISTEMA - Transferencia
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, event_type, metadata) VALUES
('test-msg-007', 'test-conversation-demo', 'system', 'event', '🔄 Conversación transferida a asesora María García', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '24 minutes'))::bigint * 1000), 'transfer',
'{"from":"bot","to":"María García","queue":"ventas","reason":"Cliente solicitó asesor humano"}');

-- 7. Mensaje del asesor humano
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, sent_by) VALUES
('test-msg-008', 'test-conversation-demo', 'out', 'text', 'Hola! Soy María, asesora de Azaleia. Con gusto te ayudo 😊', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '23 minutes'))::bigint * 1000), 'María García'),
('test-msg-009', 'test-conversation-demo', 'out', 'text', '¿Qué modelo de zapatillas te interesa?', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '22 minutes 30 seconds'))::bigint * 1000), 'María García');

-- 8. Cliente envía IMAGEN
INSERT INTO crm_messages (id, conversation_id, direction, type, text, media_url, timestamp, sent_by, metadata) VALUES
('test-msg-010', 'test-conversation-demo', 'in', 'image', 'Me gustan estas! 📸', 'https://via.placeholder.com/400x300/FF6B9D/FFFFFF?text=Zapatillas+Rosas', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '21 minutes'))::bigint * 1000), 'Cliente Demo',
'{"caption":"Me gustan estas!","mime_type":"image/jpeg","width":400,"height":300}');

-- 9. Asesora responde con imagen de producto
INSERT INTO crm_messages (id, conversation_id, direction, type, text, media_url, timestamp, sent_by, metadata) VALUES
('test-msg-011', 'test-conversation-demo', 'out', 'text', 'Excelente elección! Te muestro modelos similares:', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '20 minutes'))::bigint * 1000), 'María García', NULL),
('test-msg-012', 'test-conversation-demo', 'out', 'image', 'Olympikus Sport - S/. 189.90', 'https://via.placeholder.com/400x400/4CAF50/FFFFFF?text=Olympikus+S%2F.189.90', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '19 minutes'))::bigint * 1000), 'María García',
'{"caption":"Modelo Olympikus Sport - S/. 189.90","mime_type":"image/jpeg","product_id":"OLY-001","price":189.90}');

-- 10. Cliente pregunta
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, sent_by) VALUES
('test-msg-013', 'test-conversation-demo', 'in', 'text', 'Tienen talla 38? En qué colores?', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '18 minutes'))::bigint * 1000), 'Cliente Demo');

-- 11. MENSAJE DEL SISTEMA - Consulta CRM
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, event_type, metadata) VALUES
('test-msg-014', 'test-conversation-demo', 'system', 'event', '🔍 Consultando stock en Bitrix24...', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '17 minutes 30 seconds'))::bigint * 1000), 'bitrix_query',
'{"action":"check_stock","product":"Olympikus Sport","size":"38","system":"Bitrix24"}');

-- 12. Asesora responde con stock
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, sent_by) VALUES
('test-msg-015', 'test-conversation-demo', 'out', 'text', 'Sí tenemos! Talla 38 disponible en:\n\n✅ Rosa - 5 unidades\n✅ Negro - 8 unidades\n✅ Blanco - 3 unidades\n\nPrecio: S/. 189.90', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '16 minutes'))::bigint * 1000), 'María García');

-- 13. Cliente decide comprar
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, sent_by) VALUES
('test-msg-016', 'test-conversation-demo', 'in', 'text', 'Perfecto! Quiero el rosa 🌸', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '15 minutes'))::bigint * 1000), 'Cliente Demo'),
('test-msg-017', 'test-conversation-demo', 'in', 'text', 'Les hago la transferencia ahora', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '14 minutes 30 seconds'))::bigint * 1000), 'Cliente Demo');

-- 14. Cliente envía DOCUMENTO (voucher)
INSERT INTO crm_messages (id, conversation_id, direction, type, text, media_url, timestamp, sent_by, metadata) VALUES
('test-msg-018', 'test-conversation-demo', 'in', 'document', 'Voucher_pago_189.90.pdf', 'https://example.com/voucher.pdf', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '13 minutes'))::bigint * 1000), 'Cliente Demo',
'{"filename":"Voucher_pago_189.90.pdf","mime_type":"application/pdf","file_size":124567}');

-- 15. MENSAJE DEL SISTEMA - Documento recibido
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, event_type, metadata) VALUES
('test-msg-019', 'test-conversation-demo', 'system', 'event', '📎 Documento recibido: Voucher_pago_189.90.pdf (121 KB)', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '12 minutes 30 seconds'))::bigint * 1000), 'attachment_received',
'{"filename":"Voucher_pago_189.90.pdf","size":124567,"type":"pdf"}');

-- 16. Asesora confirma pago
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, sent_by) VALUES
('test-msg-020', 'test-conversation-demo', 'out', 'text', 'Perfecto! Ya recibí tu comprobante ✅', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '11 minutes'))::bigint * 1000), 'María García'),
('test-msg-021', 'test-conversation-demo', 'out', 'text', 'Verificando el pago... un momento por favor ⏳', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '10 minutes 30 seconds'))::bigint * 1000), 'María García');

-- 17. MENSAJE DEL SISTEMA - Nota interna
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, event_type, metadata) VALUES
('test-msg-022', 'test-conversation-demo', 'system', 'event', '📝 NOTA INTERNA: Cliente recurrente. Aprobar pago rápido. Verificar cuenta BCP ***1234', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '10 minutes'))::bigint * 1000), 'internal_note',
'{"visibility":"advisors_only","priority":"high","note_by":"María García"}');

-- 18. Cliente envía UBICACIÓN
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, sent_by, metadata) VALUES
('test-msg-023', 'test-conversation-demo', 'in', 'location', 'Mi ubicación', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '8 minutes'))::bigint * 1000), 'Cliente Demo',
'{"latitude":-12.046374,"longitude":-77.042793,"address":"Av. Javier Prado Este 4200, Santiago de Surco"}');

-- 19. MENSAJE DEL SISTEMA - Pedido creado
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, event_type, metadata) VALUES
('test-msg-024', 'test-conversation-demo', 'system', 'event', '✅ Pedido #AZ-12345 creado exitosamente\n\n📦 Olympikus Sport Talla 38 Rosa\n💰 Total: S/. 189.90\n🚚 Delivery: 24-48 horas\n📍 Envío a: Surco, Lima', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '6 minutes'))::bigint * 1000), 'order_created',
'{"order_id":"AZ-12345","product":"Olympikus Sport 38 Rosa","amount":189.90,"delivery":"24-48h","address":"Surco"}');

-- 20. Asesora envía confirmación
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, sent_by) VALUES
('test-msg-025', 'test-conversation-demo', 'out', 'text', 'Excelente! Tu pedido #AZ-12345 ha sido confirmado 🎉\n\nRecibirás un SMS cuando sea despachado.\n\n¡Gracias por tu compra!', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '4 minutes'))::bigint * 1000), 'María García');

-- 21. Cliente responde con emojis
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, sent_by) VALUES
('test-msg-026', 'test-conversation-demo', 'in', 'text', '🎉🎊 Muchas gracias!!! 💕', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '3 minutes'))::bigint * 1000), 'Cliente Demo');

-- 22. MENSAJE DEL SISTEMA - Encuesta
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, event_type, metadata) VALUES
('test-msg-027', 'test-conversation-demo', 'system', 'event', '📊 Encuesta de satisfacción enviada', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '2 minutes'))::bigint * 1000), 'survey_sent',
'{"survey_type":"post_purchase","status":"pending","expires_at":1733529600000}');

-- 23. Mensaje final
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, sent_by) VALUES
('test-msg-028', 'test-conversation-demo', 'out', 'text', 'Fue un placer atenderte! 😊\n\nSi tienes alguna consulta, escríbenos.\n\n¡Hasta pronto! 👋', (EXTRACT(EPOCH FROM (NOW() - INTERVAL '1 minute'))::bigint * 1000), 'Bot Azaleia');

-- 24. MENSAJE DEL SISTEMA - Conversación finalizada
INSERT INTO crm_messages (id, conversation_id, direction, type, text, timestamp, event_type, metadata) VALUES
('test-msg-029', 'test-conversation-demo', 'system', 'event', '✅ Conversación finalizada\n\n⏱️ Duración: 29 minutos\n👤 Atendido por: María García\n⭐ Rating: Pendiente', (EXTRACT(EPOCH FROM NOW())::bigint * 1000), 'conversation_closed',
'{"duration_minutes":29,"advisor":"María García","satisfaction":"pending","close_reason":"completed"}');

-- Actualizar conversación con último mensaje
UPDATE crm_conversations
SET last_message_at = (EXTRACT(EPOCH FROM NOW())::bigint * 1000),
    last_message_preview = '✅ Conversación finalizada - 29 mensajes'
WHERE id = 'test-conversation-demo';

-- Mostrar resultado
SELECT '✅ Chat de prueba creado exitosamente!' as resultado;
SELECT COUNT(*) as total_mensajes FROM crm_messages WHERE conversation_id = 'test-conversation-demo';
SELECT 'Ir a la sección CHAT para ver la conversación "Cliente Demo - Prueba Completa"' as instrucciones;
