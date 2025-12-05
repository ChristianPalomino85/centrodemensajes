/**
 * Script to resume a stalled campaign
 * Usage: POSTGRES_PASSWORD=xxx npx tsx server/scripts/resume-campaign.ts campaign_id
 */
import { Pool } from 'pg';
import { sendTemplateMessage } from '../../src/api/whatsapp-sender';
import { crmDb } from '../crm/db-postgres';

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'whatsapp_user',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'flowbuilder_crm',
  password: process.env.POSTGRES_PASSWORD || 'azaleia_pg_2025_secure',
  port: parseInt(process.env.POSTGRES_PORT || '5432')
});

async function getWhatsAppConfigForCampaign(phoneNumberId: string) {
  const result = await pool.query(
    'SELECT phone_number_id, access_token, waba_id, display_number FROM whatsapp_connections WHERE phone_number_id = $1',
    [phoneNumberId]
  );

  if (result.rows.length === 0) {
    throw new Error(`No connection found for phoneNumberId: ${phoneNumberId}`);
  }

  const conn = result.rows[0];
  return {
    phoneNumberId: conn.phone_number_id,
    accessToken: conn.access_token,
    wabaId: conn.waba_id,
    displayNumber: conn.display_number
  };
}

async function resumeCampaign(campaignId: string) {
  console.log(`[Resume] Starting resume for campaign ${campaignId}`);

  const campaignResult = await pool.query(
    'SELECT * FROM campaigns WHERE id = $1',
    [campaignId]
  );

  if (campaignResult.rows.length === 0) {
    console.error(`Campaign ${campaignId} not found`);
    return;
  }

  const campaign = campaignResult.rows[0];
  console.log(`[Resume] Campaign: ${campaign.name}`);
  console.log(`[Resume] Throttle: ${campaign.throttle_rate} msg/min`);

  const delayMs = (60 * 1000) / campaign.throttle_rate;
  console.log(`[Resume] Delay between messages: ${delayMs.toFixed(2)}ms`);

  // Get pending messages
  const pendingResult = await pool.query(
    'SELECT phone FROM campaign_message_details WHERE campaign_id = $1 AND status = $2 ORDER BY id',
    [campaignId, 'pending']
  );

  console.log(`[Resume] Found ${pendingResult.rows.length} pending messages`);

  if (pendingResult.rows.length === 0) {
    console.log('[Resume] No pending messages');
    await pool.query('UPDATE campaigns SET status = $1, completed_at = $2 WHERE id = $3', ['completed', Date.now(), campaignId]);
    return;
  }

  const config = await getWhatsAppConfigForCampaign(campaign.whatsapp_number_id);
  console.log(`[Resume] Using phoneNumberId: ${config.phoneNumberId}`);

  // Fetch template info from Meta
  let templateVariables = campaign.variables || [];

  const isEmptyVariables = !templateVariables ||
    (Array.isArray(templateVariables) && templateVariables.length === 0) ||
    (typeof templateVariables === 'object' && !Array.isArray(templateVariables) && Object.keys(templateVariables).length === 0);

  if (isEmptyVariables) {
    console.log('[Resume] Auto-detecting template header...');
    try {
      const { fetchMessageTemplates, uploadMedia } = await import('../../src/api/whatsapp-sender');
      const { getWhatsAppConnection } = await import('../services/whatsapp-connections');
      const connection = await getWhatsAppConnection(campaign.whatsapp_number_id);

      if (connection?.wabaId) {
        const templatesResult = await fetchMessageTemplates(connection.wabaId, config.accessToken);
        if (templatesResult.ok) {
          const template = templatesResult.templates.find(
            t => t.name === campaign.template_name && t.language === campaign.language
          );

          if (template) {
            const headerComp = template.components?.find(c => c.type === 'HEADER' && c.format === 'IMAGE');
            if (headerComp?.example?.header_handle?.[0]) {
              const headerHandle = headerComp.example.header_handle[0];
              console.log(`[Resume] Downloading header image...`);

              const imageResponse = await fetch(headerHandle);
              if (imageResponse.ok) {
                const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
                const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

                console.log(`[Resume] Uploading image to WhatsApp...`);
                const uploadResult = await uploadMedia(config, imageBuffer, contentType, 'template-header.jpg');

                if (uploadResult.ok && uploadResult.body?.id) {
                  const mediaId = uploadResult.body.id;
                  console.log(`[Resume] ✅ Uploaded with media_id: ${mediaId}`);

                  templateVariables = [
                    {
                      type: 'header',
                      parameters: [
                        {
                          type: 'image',
                          image: { id: mediaId }
                        }
                      ]
                    }
                  ];
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Resume] Could not auto-detect template header:', err);
    }
  }

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < pendingResult.rows.length; i++) {
    const phone = pendingResult.rows[i].phone;

    try {
      const result = await sendTemplateMessage(
        config,
        phone,
        campaign.template_name,
        campaign.language || 'es',
        templateVariables
      );

      if (result.ok) {
        await pool.query(
          'UPDATE campaign_message_details SET status = $1, sent_at = $2 WHERE campaign_id = $3 AND phone = $4',
          ['sent', Date.now(), campaignId, phone]
        );
        sent++;
        console.log(`[Resume] ✅ ${phone} (${sent}/${pendingResult.rows.length})`);

        // Register in CRM
        try {
          let conversation = await crmDb.getConversationByPhoneAndChannel(phone, 'whatsapp', campaign.whatsapp_number_id);

          if (!conversation) {
            conversation = await crmDb.createConversation(phone, null, null, 'whatsapp', campaign.whatsapp_number_id, config.displayNumber, null);
            await crmDb.updateConversationMeta(conversation.id, {
              status: 'closed',
              campaignId: campaign.id
            });
            conversation = await crmDb.getConversationById(conversation.id);
          } else {
            await crmDb.updateConversationMeta(conversation.id, {
              status: 'closed',
              campaignId: campaign.id
            });
          }

          await crmDb.addCampaignToConversation(conversation.id, campaign.id);

          // Fetch template components
          let templateComponents: any[] = [];
          try {
            const { fetchMessageTemplates } = await import('../../src/api/whatsapp-sender');
            const { getWhatsAppConnection } = await import('../services/whatsapp-connections');
            const connection = await getWhatsAppConnection(campaign.whatsapp_number_id);

            if (connection?.wabaId) {
              const templatesResult = await fetchMessageTemplates(connection.wabaId, config.accessToken);
              if (templatesResult.ok) {
                const template = templatesResult.templates.find(
                  t => t.name === campaign.template_name && t.language === (campaign.language || 'es')
                );
                if (template?.components) {
                  templateComponents = template.components;
                }
              }
            }
          } catch (err) {
            // Silent fail
          }

          const templateData = {
            templateName: campaign.template_name,
            language: campaign.language || 'es',
            components: templateComponents
          };

          await crmDb.appendMessage({
            convId: conversation.id,
            direction: 'outgoing',
            type: 'template',
            text: JSON.stringify(templateData),
            mediaUrl: null,
            mediaThumb: null,
            repliedToId: null,
            status: 'sent',
            providerMetadata: {
              campaign_id: campaign.id,
              template_name: campaign.template_name,
            },
          });
        } catch (crmError) {
          console.error(`[Resume] CRM error for ${phone}:`, crmError);
        }
      } else {
        await pool.query(
          'UPDATE campaign_message_details SET status = $1, error_message = $2 WHERE campaign_id = $3 AND phone = $4',
          ['failed', `Error ${result.status}`, campaignId, phone]
        );
        failed++;
        console.error(`[Resume] ❌ ${phone}: Status ${result.status}`);
      }
    } catch (error) {
      await pool.query(
        'UPDATE campaign_message_details SET status = $1, error_message = $2 WHERE campaign_id = $3 AND phone = $4',
        ['failed', error instanceof Error ? error.message : 'Unknown error', campaignId, phone]
      );
      failed++;
      console.error(`[Resume] ❌ ${phone}:`, error);
    }

    // Throttle delay
    if (i < pendingResult.rows.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.log(`[Resume] ✅ Completed: ${sent} sent, ${failed} failed`);
  await pool.query('UPDATE campaigns SET status = $1, completed_at = $2 WHERE id = $3', ['completed', Date.now(), campaignId]);
}

// Get campaign ID from command line or use default
const campaignId = process.argv[2] || 'campaign_1763483467680_wr2uvk1zr';

resumeCampaign(campaignId)
  .then(() => {
    console.log('[Resume] Done!');
    pool.end();
    process.exit(0);
  })
  .catch(error => {
    console.error('[Resume] Fatal error:', error);
    pool.end();
    process.exit(1);
  });
