#!/usr/bin/env node

/**
 * Test script for Cred402 x402 payment flow.
 * 
 * Steps:
 * 1. Hit /v1/score/:agent endpoint
 * 2. Expect 402 Payment Required with x402 headers
 * 3. Parse headers and log payment request
 * 4. (Future) Sign payment, submit, verify 200 response
 */

const API_BASE = process.env.CRED402_API_URL || 'https://api.cred402.com';
const AGENT_ADDRESS = process.env.TEST_AGENT || '0x1234567890123456789012345678901234567890';

async function testPaymentFlow() {
    console.log(`Testing payment flow for ${API_BASE}/v1/score/${AGENT_ADDRESS}`);
    
    try {
        const response = await fetch(`${API_BASE}/v1/score/${AGENT_ADDRESS}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
        });
        
        console.log(`Status: ${response.status} ${response.statusText}`);
        
        // Log all headers
        console.log('Headers:');
        for (const [key, value] of response.headers) {
            console.log(`  ${key}: ${value}`);
        }
        
        if (response.status === 402) {
            console.log('\n✅ Success: API returned 402 Payment Required');
            
            // Check for x402 headers
            const paymentRequired = response.headers.get('X-Payment-Required');
            const acceptPayment = response.headers.get('Accept-Payment');
            const paymentResponse = response.headers.get('X-Payment-Response');
            
            console.log(`X-Payment-Required: ${paymentRequired || '(missing)'}`);
            console.log(`Accept-Payment: ${acceptPayment || '(missing)'}`);
            console.log(`X-Payment-Response: ${paymentResponse || '(missing)'}`);
            
            if (acceptPayment) {
                console.log('\nPayment request detected. Parsing...');
                try {
                    const paymentRequest = JSON.parse(acceptPayment);
                    console.log('Payment request:', JSON.stringify(paymentRequest, null, 2));
                } catch (e) {
                    console.log('Failed to parse Accept-Payment header as JSON:', e.message);
                }
            }
            
            // TODO: Sign payment, submit, verify 200
            console.log('\n⚠️  Payment signing not implemented (requires wallet).');
            
        } else if (response.status === 200) {
            console.log('\n❌ Unexpected: API returned 200 (should be 402)');
            const body = await response.text();
            console.log(`Response body (first 500 chars): ${body.substring(0, 500)}`);
            
            // Check if free tier is still enabled
            const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
            console.log(`X-RateLimit-Remaining: ${rateLimitRemaining}`);
            
            if (rateLimitRemaining === '0') {
                console.log('Rate limit exhausted but still 200. x402 middleware may be failing.');
            }
        } else {
            console.log('\n⚠️  Unexpected status:', response.status);
            const body = await response.text();
            console.log(`Body: ${body.substring(0, 500)}`);
        }
    } catch (error) {
        console.error('Request failed:', error.message);
    }
}

// Run if called directly
if (import.meta.url?.endsWith(process.argv[1])) {
    testPaymentFlow();
}

export { testPaymentFlow };