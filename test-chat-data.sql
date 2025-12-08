-- Script para crear chat de prueba con TODOS los tipos de mensajes
-- Ejecutar: sudo -u postgres psql -d flowbuilder_crm -f test-chat-data.sql

-- 1. Crear conversación de prueba
INSERT INTO crm_conversations (
  id,
  phone_number,
  contact_name,
  status,
  unread_count,
  last_message,
  last_message_time,
  created_at,
  channel,
  is_online,
  autoriza_publicidad
) VALUES (
  'test-conversation-001',
  '+51987654321',
  'Cliente de Prueba Demo',
  'assigned',
  0,
  'Este es un chat de prueba con todos los tipos de mensajes',
  EXTRACT(EPOCH FROM NOW()) * 1000,
  EXTRACT(EPOCH FROM NOW()) * 1000,
  'whatsapp',
  false,
  true
) ON CONFLICT (id) DO UPDATE SET
  last_message = EXCLUDED.last_message,
  last_message_time = EXCLUDED.last_message_time;

-- 2. Mensajes del cliente (incoming)
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type) VALUES
('test-conversation-001', 'incoming', 'Hola, buenos días! 👋', EXTRACT(EPOCH FROM (NOW() - INTERVAL '30 minutes')) * 1000, 'Cliente de Prueba Demo', 'text'),
('test-conversation-001', 'incoming', 'Quisiera información sobre sus productos', EXTRACT(EPOCH FROM (NOW() - INTERVAL '29 minutes')) * 1000, 'Cliente de Prueba Demo', 'text'),
('test-conversation-001', 'incoming', 'Tienen zapatillas deportivas?', EXTRACT(EPOCH FROM (NOW() - INTERVAL '28 minutes')) * 1000, 'Cliente de Prueba Demo', 'text');

-- 3. Mensaje del bot (outgoing)
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type) VALUES
('test-conversation-001', 'outgoing', '¡Hola! Bienvenido a Azaleia 😊\n\nSí, tenemos una amplia variedad de zapatillas deportivas. ¿Te gustaría ver nuestro catálogo?', EXTRACT(EPOCH FROM (NOW() - INTERVAL '27 minutes')) * 1000, 'Bot', 'text');

-- 4. Mensaje con botones interactivos
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type, metadata) VALUES
('test-conversation-001', 'outgoing', 'Selecciona una opción:', EXTRACT(EPOCH FROM (NOW() - INTERVAL '26 minutes')) * 1000, 'Bot', 'interactive',
'{"type":"buttons","buttons":[{"id":"btn1","title":"Ver Catálogo 📸"},{"id":"btn2","title":"Hablar con Asesor 👤"},{"id":"btn3","title":"Horarios 🕐"}]}');

-- 5. Respuesta del cliente
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type) VALUES
('test-conversation-001', 'incoming', 'Hablar con Asesor 👤', EXTRACT(EPOCH FROM (NOW() - INTERVAL '25 minutes')) * 1000, 'Cliente de Prueba Demo', 'text');

-- 6. MENSAJE DEL SISTEMA - Transferencia
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type, metadata) VALUES
('test-conversation-001', 'system', '🔄 Conversación transferida a asesor María García', EXTRACT(EPOCH FROM (NOW() - INTERVAL '24 minutes')) * 1000, 'Sistema', 'system',
'{"action":"transfer","advisor":"María García","reason":"Cliente solicitó hablar con asesor"}');

-- 7. Mensaje del asesor humano
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type) VALUES
('test-conversation-001', 'outgoing', 'Hola! Soy María, asesora de Azaleia. Con gusto te ayudo 😊', EXTRACT(EPOCH FROM (NOW() - INTERVAL '23 minutes')) * 1000, 'María García', 'text'),
('test-conversation-001', 'outgoing', '¿Qué modelo de zapatillas te interesa?', EXTRACT(EPOCH FROM (NOW() - INTERVAL '23 minutes')) * 1000, 'María García', 'text');

-- 8. Cliente envía IMAGEN
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type, metadata) VALUES
('test-conversation-001', 'incoming', 'Me gustan estas! 📸', EXTRACT(EPOCH FROM (NOW() - INTERVAL '22 minutes')) * 1000, 'Cliente de Prueba Demo', 'image',
'{"media_url":"https://via.placeholder.com/400x300/FF6B9D/FFFFFF?text=Zapatillas+Rosas","caption":"Me gustan estas!","mime_type":"image/jpeg"}');

-- 9. Asesor responde con imagen de producto
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type, metadata) VALUES
('test-conversation-001', 'outgoing', 'Excelente elección! Te muestro más modelos similares:', EXTRACT(EPOCH FROM (NOW() - INTERVAL '21 minutes')) * 1000, 'María García', 'text'),
('test-conversation-001', 'outgoing', 'Modelo Olympikus Sport - S/. 189.90', EXTRACT(EPOCH FROM (NOW() - INTERVAL '20 minutes')) * 1000, 'María García', 'image',
'{"media_url":"https://via.placeholder.com/400x400/4CAF50/FFFFFF?text=Olympikus+Sport+S%2F.189.90","caption":"Modelo Olympikus Sport - S/. 189.90","mime_type":"image/jpeg"}');

-- 10. Cliente pregunta por tallas
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type) VALUES
('test-conversation-001', 'incoming', 'Tienen talla 38? En qué colores?', EXTRACT(EPOCH FROM (NOW() - INTERVAL '19 minutes')) * 1000, 'Cliente de Prueba Demo', 'text');

-- 11. MENSAJE DEL SISTEMA - Consulta a CRM
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type, metadata) VALUES
('test-conversation-001', 'system', '🔍 Consultando disponibilidad en Bitrix24...', EXTRACT(EPOCH FROM (NOW() - INTERVAL '18 minutes')) * 1000, 'Sistema', 'system',
'{"action":"bitrix_query","product":"Olympikus Sport","size":"38"}');

-- 12. Asesor responde con disponibilidad
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type) VALUES
('test-conversation-001', 'outgoing', 'Sí tenemos! Talla 38 disponible en:\n\n✅ Rosa\n✅ Negro\n✅ Blanco\n\nPrecio: S/. 189.90', EXTRACT(EPOCH FROM (NOW() - INTERVAL '17 minutes')) * 1000, 'María García', 'text');

-- 13. Cliente envía DOCUMENTO (comprobante)
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type, metadata) VALUES
('test-conversation-001', 'incoming', 'Perfecto! Les hago la transferencia ahora', EXTRACT(EPOCH FROM (NOW() - INTERVAL '16 minutes')) * 1000, 'Cliente de Prueba Demo', 'text'),
('test-conversation-001', 'incoming', 'Voucher.pdf', EXTRACT(EPOCH FROM (NOW() - INTERVAL '15 minutes')) * 1000, 'Cliente de Prueba Demo', 'document',
'{"media_url":"https://example.com/voucher.pdf","filename":"Voucher_pago_189.90.pdf","mime_type":"application/pdf","file_size":124567}');

-- 14. MENSAJE DEL SISTEMA - Documento recibido
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type, metadata) VALUES
('test-conversation-001', 'system', '📎 Documento recibido: Voucher_pago_189.90.pdf (121 KB)', EXTRACT(EPOCH FROM (NOW() - INTERVAL '14 minutes')) * 1000, 'Sistema', 'system',
'{"action":"document_received","filename":"Voucher_pago_189.90.pdf","size":"124567"}');

-- 15. Asesor confirma
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type) VALUES
('test-conversation-001', 'outgoing', 'Perfecto! Ya recibí tu comprobante ✅', EXTRACT(EPOCH FROM (NOW() - INTERVAL '13 minutes')) * 1000, 'María García', 'text'),
('test-conversation-001', 'outgoing', 'Estoy verificando el pago con el área de finanzas...', EXTRACT(EPOCH FROM (NOW() - INTERVAL '13 minutes')) * 1000, 'María García', 'text');

-- 16. MENSAJE DEL SISTEMA - Nota interna (NO visible para cliente)
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type, metadata) VALUES
('test-conversation-001', 'system', '📝 NOTA INTERNA: Verificar pago en cuenta BCP ***1234. Cliente es recurrente, aprobar rápido.', EXTRACT(EPOCH FROM (NOW() - INTERVAL '12 minutes')) * 1000, 'Sistema', 'internal_note',
'{"action":"internal_note","visibility":"advisors_only","priority":"high"}');

-- 17. Asesor envía AUDIO
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type, metadata) VALUES
('test-conversation-001', 'outgoing', 'Audio mensaje', EXTRACT(EPOCH FROM (NOW() - INTERVAL '10 minutes')) * 1000, 'María García', 'audio',
'{"media_url":"https://example.com/audio.ogg","duration":8,"mime_type":"audio/ogg"}');

-- 18. Cliente responde
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type) VALUES
('test-conversation-001', 'incoming', 'Genial! A qué dirección lo envían?', EXTRACT(EPOCH FROM (NOW() - INTERVAL '9 minutes')) * 1000, 'Cliente de Prueba Demo', 'text');

-- 19. Asesor envía UBICACIÓN
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type, metadata) VALUES
('test-conversation-001', 'outgoing', 'Te lo enviamos a la dirección que tienes registrada', EXTRACT(EPOCH FROM (NOW() - INTERVAL '8 minutes')) * 1000, 'María García', 'text'),
('test-conversation-001', 'outgoing', 'Ubicación', EXTRACT(EPOCH FROM (NOW() - INTERVAL '7 minutes')) * 1000, 'María García', 'location',
'{"latitude":-12.046374,"longitude":-77.042793,"address":"Av. Javier Prado Este 4200, Santiago de Surco, Lima","name":"Tienda Azaleia Jockey Plaza"}');

-- 20. MENSAJE DEL SISTEMA - Pedido creado
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type, metadata) VALUES
('test-conversation-001', 'system', '✅ Pedido #12345 creado exitosamente\n📦 Producto: Olympikus Sport Talla 38 Rosa\n💰 Total: S/. 189.90\n🚚 Delivery: 24-48 horas', EXTRACT(EPOCH FROM (NOW() - INTERVAL '6 minutes')) * 1000, 'Sistema', 'system',
'{"action":"order_created","order_id":"12345","product":"Olympikus Sport","amount":189.90,"delivery":"24-48h"}');

-- 21. Mensaje con template de WhatsApp
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type, metadata) VALUES
('test-conversation-001', 'outgoing', 'Gracias por tu compra! 🎉\n\nTu pedido #12345 ha sido confirmado.\n\nRecibirás un SMS cuando sea despachado.', EXTRACT(EPOCH FROM (NOW() - INTERVAL '5 minutes')) * 1000, 'Bot', 'template',
'{"template_name":"order_confirmation","variables":["12345"],"language":"es"}');

-- 22. Cliente envía emoji y sticker
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type) VALUES
('test-conversation-001', 'incoming', '🎉🎊 Muchas gracias!!!', EXTRACT(EPOCH FROM (NOW() - INTERVAL '4 minutes')) * 1000, 'Cliente de Prueba Demo', 'text'),
('test-conversation-001', 'incoming', 'Sticker', EXTRACT(EPOCH FROM (NOW() - INTERVAL '3 minutes')) * 1000, 'Cliente de Prueba Demo', 'sticker',
'{"media_url":"https://example.com/sticker.webp","mime_type":"image/webp"}');

-- 23. MENSAJE DEL SISTEMA - Encuesta de satisfacción
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type, metadata) VALUES
('test-conversation-001', 'system', '📊 Encuesta de satisfacción enviada al cliente', EXTRACT(EPOCH FROM (NOW() - INTERVAL '2 minutes')) * 1000, 'Sistema', 'system',
'{"action":"survey_sent","survey_type":"post_purchase","status":"pending"}');

-- 24. Mensaje final del bot
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type) VALUES
('test-conversation-001', 'outgoing', 'Fue un placer atenderte! Si tienes alguna consulta, escríbenos 😊\n\n¡Hasta pronto! 👋', EXTRACT(EPOCH FROM (NOW() - INTERVAL '1 minute')) * 1000, 'Bot', 'text');

-- 25. MENSAJE DEL SISTEMA - Conversación cerrada
INSERT INTO crm_messages (conversation_id, direction, content, timestamp, sender_name, message_type, metadata) VALUES
('test-conversation-001', 'system', '✅ Conversación finalizada\n⏱️ Duración: 29 minutos\n👤 Atendido por: María García\n⭐ Satisfacción: Pendiente', EXTRACT(EPOCH FROM NOW()) * 1000, 'Sistema', 'system',
'{"action":"conversation_closed","duration_minutes":29,"advisor":"María García","satisfaction":"pending"}');

-- Actualizar última hora de mensaje
UPDATE crm_conversations
SET last_message_time = EXTRACT(EPOCH FROM NOW()) * 1000,
    last_message = '✅ Conversación finalizada'
WHERE id = 'test-conversation-001';

-- Mostrar resultado
SELECT 'Chat de prueba creado exitosamente!' as resultado;
SELECT COUNT(*) as total_mensajes FROM crm_messages WHERE conversation_id = 'test-conversation-001';
