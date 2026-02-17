import asyncio
import json
import logging
import os
import time
import hashlib
from typing import Dict, Any
import boto3
from bedrock_agentcore import BedrockAgentCoreApp
from strands import Agent, tool
import PyPDF2
from docx import Document
from pathlib import Path
from strands.hooks import AgentInitializedEvent, HookProvider, HookRegistry, MessageAddedEvent

# Import memory management modules
from bedrock_agentcore_starter_toolkit.operations.memory.manager import MemoryManager
from bedrock_agentcore.memory.constants import ConversationalMessage, MessageRole
from bedrock_agentcore.memory.session import MemorySession, MemorySessionManager

# Define message role constants
USER = MessageRole.USER
ASSISTANT = MessageRole.ASSISTANT

# Configuration
REGION = os.getenv('AWS_REGION', 'us-east-1') # AWS region for the agent
ACTOR_ID = "user_123" # It can be any unique identifier (AgentID, User ID, etc.)
SESSION_ID = "personal_session_001" # Unique session identifier

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize AWS clients
s3_client = boto3.client('s3')

# Environment variables
MODEL_ID = os.environ.get('MODEL_ID', 'us.anthropic.claude-3-5-sonnet-20241022-v2:0')
# Initialize AgentCore app
app = BedrockAgentCoreApp()

# Initialize Memory Manager 
memory_manager = MemoryManager(region_name=REGION)
memory_name = "ResumeAnalyzerMemoryManager"

logger.info(f"✅ MemoryManager initialized for region: {REGION}")
logger.info(f"Memory manager type: {type(memory_manager)}")

# Create memory resource using MemoryManager
logger.info(f"Creating memory '{memory_name}' for short-term conversational storage...")

try:
    memory = memory_manager.get_or_create_memory(
        name=memory_name,
        strategies=[],  # No strategies for short-term memory
        description="Short-term memory for resume analyzer",
        event_expiry_days=7,  # Retention period for short-term memory
        memory_execution_role_arn=None,  # Optional for short-term memory
    )
    memory_id = memory.id
    logger.info(f"✅ Successfully created/retrieved memory with MemoryManager:")
    logger.info(f"   Memory ID: {memory_id}")
    logger.info(f"   Memory Name: {memory.name}")
    logger.info(f"   Memory Status: {memory.status}")
    
except Exception as e:
    # Handle any errors during memory creation with enhanced error reporting
    logger.error(f"❌ Memory creation failed: {e}")
    logger.error(f"Error type: {type(e).__name__}")
    import traceback
    traceback.print_exc()
    
    # Cleanup on error - delete the memory if it was partially created
    if 'memory_id' in locals():
        try:
            logger.info(f"Attempting cleanup of partially created memory: {memory_id}")
            memory_manager.delete_memory(memory_id)
            logger.info(f"✅ Successfully cleaned up memory: {memory_id}")
        except Exception as cleanup_error:
            logger.error(f"❌ Failed to clean up memory: {cleanup_error}")
    
    # Re-raise the original exception
    raise

# Initialize the session memory manager
session_manager = MemorySessionManager(memory_id=memory.id, region_name=REGION)

# Global session tracking
current_session = None
current_session_id = None

logger.info(f"✅ Session manager initialized for memory: {memory.id}")

class MemoryHookProvider(HookProvider):
    def __init__(self, memory_session: MemorySession):  # Accept MemorySession instead
        self.memory_session = memory_session
    
    def on_agent_initialized(self, event: AgentInitializedEvent):
        """Load recent conversation history when agent starts using MemorySession"""
        try:
            # Use the pre-configured memory session (no need for actor_id/session_id)
            recent_turns = self.memory_session.get_last_k_turns(k=5)
            
            if recent_turns:
                # Format conversation history for context
                context_messages = []
                for turn in recent_turns:
                    for message in turn:
                        # Handle both EventMessage objects and dict formats
                        if hasattr(message, 'role') and hasattr(message, 'content'):
                            role = message['role']
                            content = message['content']
                        else:
                            role = message.get('role', 'unknown')
                            content = message.get('content', {}).get('text', '')
                        context_messages.append(f"{role}: {content}")
                
                context = "\n".join(context_messages)
                # Add context to agent's system prompt
                event.agent.system_prompt += f"\n\nRecent conversation:\n{context}"
                logger.info(f"✅ Loaded {len(recent_turns)} conversation turns using MemorySession")
                
        except Exception as e:
            logger.error(f"Memory load error: {e}")

    def on_message_added(self, event: MessageAddedEvent):
        """Store messages in memory using MemorySession"""
        messages = event.agent.messages
        try:
            if messages and len(messages) > 0 and messages[-1]["content"][0].get("text"):
                message_text = messages[-1]["content"][0]["text"]
                message_role = MessageRole.USER if messages[-1]["role"] == "user" else MessageRole.ASSISTANT
                
                # Use memory session instance (no need to pass actor_id/session_id)
                result = self.memory_session.add_turns(
                    messages=[ConversationalMessage(message_text, message_role)]
                )
                
                event_id = result['eventId']
                logger.info(f"✅ Stored message with Event ID: {event_id}, Role: {message_role.value}")
                
        except Exception as e:
            logger.error(f"Memory save error: {e}")
            import traceback
            logger.error(f"Full traceback: {traceback.format_exc()}")
    
    def register_hooks(self, registry: HookRegistry):
        # Register memory hooks
        registry.add_callback(MessageAddedEvent, self.on_message_added)
        registry.add_callback(AgentInitializedEvent, self.on_agent_initialized)
        logger.info("✅ Memory hooks registered with MemorySession")

def get_or_create_session(resume_key: str = None, job_description_key: str = None):
    """Get existing session or create new one based on documents"""
    global current_session, current_session_id
    
    if resume_key:
        # New document upload - create new session
        session_data = f"{resume_key}_{job_description_key or 'no_job'}"
        session_id = hashlib.md5(session_data.encode()).hexdigest()[:16]
        
        if session_id != current_session_id:
            current_session = session_manager.create_memory_session(
                actor_id=ACTOR_ID,
                session_id=session_id
            )
            current_session_id = session_id
            logger.info(f"✅ Created new session: {session_id}")
    
    return current_session

async def process_query_with_strands_agents(query: str):
    """Process plain text queries using Strands agents with memory context"""
    try:
        session = get_or_create_session()
        memory_hook_provider = MemoryHookProvider(session)
        
        agent = Agent(
            model=MODEL_ID,
            system_prompt="""You are an expert HR resume analyzer with access to previous conversations 
            about specific resume and job combinations. Use context to provide relevant responses.""",
            hooks=[memory_hook_provider]
        )
        
        return agent.stream_async(query)
        
    except Exception as e:
        logger.error(f"❌ Error in query processing: {str(e)}")
        raise

#@app.entrypoint
async def invoke(payload):
    """AgentCore entrypoint for HR resume evaluation"""
    try:
        logger.info(f"🚀 Starting HR Agent invocation")
        logger.info(f"📥 Received payload: {json.dumps(payload, indent=2)}")
        
        bucket = payload.get('bucket')
        resume_key = payload.get('resume_key')
        job_description_key = payload.get('job_description_key')
        job_analysis_key = payload.get('job_analysis_key')
        
        # Check if this is a plain text query
        if 'query' in payload or 'message' in payload:
            query = payload.get('query') or payload.get('message', '')
            logger.info(f"💬 Processing follow-up query: {query}")
            agent_stream = await process_query_with_strands_agents(query)
        # JD-only analysis (no resume)
        elif job_description_key and not resume_key:
            logger.info("📋 Processing JD-only analysis")
            agent_stream = await process_jd_only(bucket, job_description_key)
        # Full resume + JD analysis
        else:
            if not resume_key:
                logger.error("❌ Missing resume_key in payload")
                raise ValueError("resume_key is required in payload")
            
            logger.info("🔄 Starting resume processing with Strands agents")
            get_or_create_session(resume_key, job_description_key)
            agent_stream = await process_resume_with_strands_agents(
                bucket, resume_key,
                job_description_key=job_description_key,
                job_analysis_key=job_analysis_key,
            )
        
        tool_name = None
        event_count = 0
        collected_data = []  # for resume flow: collect full response to parse and upload JSON

        try:
            async for event in agent_stream:
                event_count += 1
                logger.debug(f"📊 Processing event #{event_count}: {type(event)}")

                if "data" in event:
                    tool_name = None
                    chunk = event["data"]
                    data_length = len(str(chunk))
                    logger.debug(f"📤 Yielding data chunk of {data_length} characters")
                    if resume_key and bucket:
                        collected_data.append(chunk)
                    yield chunk

            # Resume flow: parse final JSON and upload to S3 (same pattern as process_jd_only)
            if resume_key and bucket and collected_data:
                full_text = "".join(str(c) for c in collected_data)
                try:
                    analysis_json = parse_json_from_text(full_text)
                    resume_folder = "/".join(resume_key.split("/")[:-1])
                    resume_stem = Path(resume_key).stem
                    analysis_s3_key = f"{resume_folder}/{resume_stem}.json"
                    upload_analysis_to_s3(bucket, analysis_s3_key, analysis_json)
                    status_msg = json.dumps({"status": "success", "message": "Resume analysis saved to S3", "s3_key": analysis_s3_key})
                    yield f"\n\n{status_msg}"
                except Exception as up:
                    logger.warning(f"⚠️ Could not parse or upload resume analysis JSON: {up}")
                    
        except Exception as e:
            logger.error(f"❌ Error in agent stream processing: {str(e)}")
            yield f"Error: {str(e)}"
            
        logger.info(f"✅ Completed processing {event_count} events")
        
    except Exception as e:
        logger.error(f"❌ Error in agent stream processing: {str(e)}")
        yield f"Error: {str(e)}"

async def process_jd_only(bucket: str, job_description_key: str):
    """Process only job description to extract structured info"""
    try:
        logger.info(f"📥 Downloading JD from s3://{bucket}/{job_description_key}")
        job_content = download_s3_file(bucket, job_description_key)
        logger.info(f"✅ JD downloaded, length: {len(job_content)} characters")
        
        analyzer_agent = Agent(
            model=MODEL_ID,
            system_prompt="""You are a Job Analyzer Agent specializing in extracting job requirements.

Analyze and extract:
1. summary: A very brief summary (1-2 lines) highlighting the key points of the job description
2. title: A suitable job title (e.g., "DevOps Engineer", "Data Scientist", "Solution Architect")
3. client: Client/company name if mentioned
4. keywords: List of top 5-6 key technical skills and technologies (e.g., ["AWS", "Python", "Kubernetes"])
5. required_qualifications: Education, experience, skills, certifications
6. preferred_qualifications: Additional beneficial skills
7. skills: Technical, domain, soft skills with proficiency levels
8. company_culture: Environment, values, work style
9. compensation_benefits: Salary range and benefits if provided

Return ONLY a valid JSON object with these fields."""
        )
        
        result = analyzer_agent(job_content)
        
        # Extract JSON text from result.message.content[0]['text']
        if hasattr(result, 'message') and 'content' in result.message:
            content = result.message['content']
            if isinstance(content, list) and len(content) > 0:
                jd_text = content[0].get('text', '')
            else:
                jd_text = str(content)
        else:
            jd_text = safe_extract_content(result)
        
        logger.info(f"📝 Extracted text (first 200 chars): {jd_text[:200]}")
        
        jd_json = parse_json_from_text(jd_text)
        jd_folder = '/'.join(job_description_key.split('/')[:-1])
        s3_key = f"{jd_folder}/jd.json"
        
        upload_analysis_to_s3(bucket, s3_key, jd_json)
        logger.info("✅ JD analysis saved successfully")
        
        # Yield same event format as resume flow so invoke() handles both consistently
        status_msg = json.dumps({"status": "success", "message": "JD analysis completed", "s3_key": s3_key})
        
        async def stream_result():
            yield {"data": status_msg}
        
        return stream_result()
        
    except Exception as e:
        logger.error(f"❌ Error in JD processing: {str(e)}")
        raise

async def process_resume_with_strands_agents(
    bucket: str,
    resume_key: str,
    job_description_key: str = None,
    job_analysis_key: str = None,
) -> Dict[str, Any]:
    """Process resume using Strands multi-agent collaboration.
    Job is always analyzed first; we download the job analysis JSON from job_analysis_key
    (or fall back to raw job description from job_description_key) and use it for evaluation.
    """
    try:
        logger.info(f"📥 Downloading resume from s3://{bucket}/{resume_key}")
        resume_content = download_s3_file(bucket, resume_key)
        logger.info(f"✅ Resume downloaded, length: {len(resume_content)} characters")
        
        job_content = None
        if job_analysis_key:
            logger.info(f"📥 Downloading job analysis from s3://{bucket}/{job_analysis_key}")
            try:
                job_analysis_raw = download_s3_file(bucket, job_analysis_key)
                job_analysis_data = json.loads(job_analysis_raw)
                job_content = json.dumps(job_analysis_data, indent=2, ensure_ascii=False)
                logger.info("✅ Job analysis JSON loaded")
            except Exception as e:
                logger.warning(f"⚠️ Failed to load job_analysis_key, falling back to job description: {e}")
        if job_content is None and job_description_key:
            logger.info(f"📥 Downloading job description from s3://{bucket}/{job_description_key}")
            job_content = download_s3_file(bucket, job_description_key)
            logger.info(f"✅ Job description downloaded, length: {len(job_content)} characters")
        if job_content is None:
            logger.info("ℹ️ No job description or analysis provided, using default")
            job_content = "No specific job description provided."
        
        logger.info("🤖 Creating HR Supervisor agent")
        supervisor_agent = create_supervisor_agent()
        logger.info("✅ HR Supervisor agent created successfully")
        
        evaluation_request = f"""
        Please evaluate this candidate for the position using your specialized agent team.
        
        RESUME:
        {resume_content}
        
        JOB REQUIREMENTS (already analyzed; use this directly):
        {job_content}

        Work with your team to:
        1. ResumeParserAgent: extract structured information (name, experience, skills)
        2. ResumeEvaluatorAgent: evaluate candidate fit
        3. GapIdentifierAgent: identify missing qualifications
        4. CandidateRaterAgent: provide numerical rating (use 0-100 scale for scores)

        Your final response MUST be a single JSON object in a ```json ... ``` block, matching the exact structure defined in your system prompt (candidate, coreSkills, domainSkills, evidenceSnippets, gaps, recommendation). No other text or markdown outside the JSON block.
        """
        
        # Execute evaluation
        logger.info("🚀 Starting AgentCore multi-agent evaluation...")
        logger.info(f"📝 Evaluation request length: {len(evaluation_request)} characters")
        agent_stream = supervisor_agent.stream_async(evaluation_request)
        logger.info("✅ Agent stream initialized successfully")
        return agent_stream
        
    except Exception as e:
        logger.error(f"❌ Error in resume processing: {str(e)}")
        logger.error(f"🔍 Error details: {type(e).__name__}")
        raise

def create_supervisor_agent():
    """Create the HR Supervisor agent with specialized tools.
    Job analysis is always provided in the request; the analyze_job_requirements tool is not used.
    """
    session = get_or_create_session()
    memory_hook_provider = MemoryHookProvider(session)
    
    @tool
    def extract_resume_info(resume_text: str) -> str:
        """Extract structured information from resume text"""
        parser_agent = Agent(
            model=MODEL_ID,
            system_prompt="""You are a Resume Parser Agent specializing in extracting structured information from resumes.

Extract the following information:
1. Personal Information (name, contact, title, URLs, experiencePeriod)
2. Work Experience (companies, titles, dates, achievements, technologies)
3. Education (degrees, institutions, dates, coursework)
4. Skills (technical, domain, soft skills, languages, proficiency)
5. Projects (names, descriptions, technologies, outcomes)

Structure your response as a JSON object with these categories."""
        )
        
        result = parser_agent(resume_text)
        return safe_extract_content(result)
    
    @tool
    def evaluate_candidate_fit(resume_info: str, job_requirements: str) -> str:
        """Evaluate candidate fit"""
        evaluator_agent = Agent(
            model=MODEL_ID,
            system_prompt="""You are a Resume Evaluator Agent specializing in comparing candidates against job requirements.

Evaluate:
1. Skills Match Analysis (technical alignment, proficiency, missing skills)
2. Experience Relevance Assessment (industry, role similarity, years)
3. Education Fit Evaluation (degree requirements, certifications)
4. Project Relevance Review (scale, technology alignment)

Structure your response as a JSON object with detailed analysis."""
        )
        
        evaluation_request = f"RESUME INFO:\n{resume_info}\n\nJOB REQUIREMENTS:\n{job_requirements}"
        result = evaluator_agent(evaluation_request)
        return safe_extract_content(result)

    @tool
    def identify_gaps(resume_info: str, job_requirements: str) -> str:
        """Identify gaps and inconsistencies"""
        gap_agent = Agent(
            model=MODEL_ID,
            system_prompt="""You are a Gap Identifier Agent specializing in finding gaps and inconsistencies.

Identify:
1. Missing Qualifications (required skills, education, experience)
2. Experience Gaps (timeline gaps, missing industry experience)
3. Skill Mismatches (core skills, domain/functional skills)
4. Areas Needing Clarification (vague accomplishments, unclear levels)

Structure your response as a JSON object with specific examples."""
        )
        
        gap_request = f"RESUME INFO:\n{resume_info}\n\nJOB REQUIREMENTS:\n{job_requirements}"
        result = gap_agent(gap_request)
        return safe_extract_content(result)

    @tool
    def rate_candidate(resume_info: str, job_requirements: str, evaluation_info: str) -> str:
        """Rate candidate on 1-5 scale"""
        rater_agent = Agent(
            model=MODEL_ID,
            system_prompt="""You are a Candidate Rater Agent specializing in scoring candidates on a 1-5 scale.

Provide:
1. Overall Fit Score (1-5 scale with clear criteria)
2. Detailed Justification (evidence-based reasoning)
3. Strengths (key qualifications and achievements)
4. Weaknesses (missing qualifications and gaps)
5. Risk Assessment (likelihood of success, challenges)

Structure your response as a JSON object with numerical rating and analysis."""
        )
        
        rating_request = f"RESUME INFO:\n{resume_info}\n\nJOB REQUIREMENTS:\n{job_requirements}\n\nEVALUATION:\n{evaluation_info}"
        result = rater_agent(rating_request)
        return safe_extract_content(result)


    # Create the main HR Supervisor Agent (job analysis is always provided in the request)
    supervisor_agent = Agent(
        model=MODEL_ID,
        hooks= [memory_hook_provider],
        tools=[
            extract_resume_info,
            evaluate_candidate_fit,
            identify_gaps,
            rate_candidate,
        ],
        system_prompt="""You are the Supervisor Agent for HR resume evaluation running on Amazon Bedrock AgentCore Runtime.

Coordinate with your specialized team to provide comprehensive candidate evaluations:

1. Have ResumeParserAgent extract structured information from the resume (name, experience, skills)
2. Have ResumeEvaluatorAgent evaluate candidate fit (use the JOB REQUIREMENTS already provided in the request)
3. Have GapIdentifierAgent identify missing qualifications
4. Have CandidateRaterAgent provide numerical rating (convert 1-5 scale to 0-100 for overallScore, coreScore, domainScore, softScore)

CRITICAL: Your final output MUST be a single valid JSON object only (no markdown, no extra text). Wrap it in a ```json code block. The JSON must match this exact structure so the UI can map all fields correctly. There is always exactly one candidate per analysis.

{
  "candidate": {
    "id": "unique_candidate_id",
    "name": "Full Name from resume",
    "level": "Senior | Mid | Junior",
    "experienceYears": number,
    "overallScore": number 0-100,
    "coreScore": number 0-100,
    "domainScore": number 0-100,
    "softScore": number 0-100,
    "initials": "XX (first letters of first and last name)"
  },
  "coreSkills": [
    {
      "name": "Skill name",
      "years": "X yrs",
      "level": "Expert | Strong | Basic",
      "status": "pass | partial | fail"
    }
  ],
  "domainSkills": [
    {
      "skill": "Domain skill name",
      "priority": "High | Medium | Low",
      "level": "Expert | Strong | Basic",
      "evidence": "Short evidence from resume"
    }
  ],
  "evidenceSnippets": [
    "Quote or snippet 1 from resume",
    "Quote or snippet 2",
    "Quote or snippet 3"
  ],
  "gaps": [
    "Gap or risk 1",
    "Gap or risk 2"
  ],
  "recommendation": "One or two paragraph recommendation: whether to proceed, key strengths, areas to probe in interview."
}

Rules:
- candidate: single object for the evaluated candidate. Use id from resume (e.g. hash of name) or generate a short unique id.
- coreSkills: 4-8 items. status must be exactly "pass", "partial", or "fail".
- domainSkills: 3-6 items. priority must be "High", "Medium", or "Low". level must be "Expert", "Strong", or "Basic".
- evidenceSnippets: 3-6 strings, direct quotes or paraphrased evidence from the resume.
- gaps: 2-5 strings, specific gaps or risks.
- recommendation: single string, one or two paragraphs.
- All scores (overallScore, coreScore, domainScore, softScore) must be numbers 0-100. Convert from 1-5 scale if needed: 5->90-100, 4->75-89, 3->60-74, 2->40-59, 1->0-39.

Output ONLY the JSON object inside a ```json ... ``` block.""")
    
    return supervisor_agent

def safe_extract_content(result) -> str:
    """Extract text content from Strands agent response"""
    try:
        # Handle different response formats
        if hasattr(result, 'content') and isinstance(result.content, list):
            text_parts = []
            for item in result.content:
                if hasattr(item, 'text'):
                    text_parts.append(item.text)
                elif isinstance(item, dict) and 'text' in item:
                    text_parts.append(item['text'])
                else:
                    text_parts.append(str(item))
            return '\n'.join(text_parts)
        elif hasattr(result, 'content'):
            return str(result.content)
        elif hasattr(result, 'message'):
            return str(result.message)
        elif isinstance(result, dict):
            # Handle dict response format from AgentCore
            if 'role' in result and 'content' in result:
                content = result['content']
                if isinstance(content, list):
                    text_parts = []
                    for item in content:
                        if isinstance(item, dict) and 'text' in item:
                            text_parts.append(item['text'])
                        else:
                            text_parts.append(str(item))
                    return '\n'.join(text_parts)
                else:
                    return str(content)
            # Handle message format
            elif 'message' in result:
                message = result['message']
                if isinstance(message, dict) and 'content' in message:
                    content = message['content']
                    if isinstance(content, list):
                        text_parts = []
                        for item in content:
                            if isinstance(item, dict) and 'text' in item:
                                text_parts.append(item['text'])
                            else:
                                text_parts.append(str(item))
                        return '\n'.join(text_parts)
                    else:
                        return str(content)
                else:
                    return str(message)
            # Handle direct text content
            elif isinstance(result, str):
                return result
            return str(result)
        else:
            return str(result)
    except Exception as e:
        logger.error(f"Error extracting content: {str(e)}")
        logger.debug(f"Result type: {type(result)}, Result: {str(result)[:500]}")
        return str(result)

def download_s3_file(bucket: str, key: str) -> str:
    """Download and read content from S3 file (supports txt, docx, pdf)"""
    try:
        import tempfile
        
        # Download file to temporary location
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            s3_client.download_fileobj(bucket, key, temp_file)
            temp_path = temp_file.name
        
        try:
            # Determine file type from S3 key extension
            file_extension = Path(key).suffix.lower()
            
            if file_extension == '.txt':
                with open(temp_path, 'r', encoding='utf-8') as file:
                    return file.read()
            
            elif file_extension == '.docx':
                doc = Document(temp_path)
                return '\n'.join([paragraph.text for paragraph in doc.paragraphs])
            
            elif file_extension == '.pdf':
                with open(temp_path, 'rb') as file:
                    pdf_reader = PyPDF2.PdfReader(file)
                    text = ''
                    for page in pdf_reader.pages:
                        text += page.extract_text() + '\n'
                    return text
            
            else:
                # Default to text for unknown extensions
                with open(temp_path, 'r', encoding='utf-8') as file:
                    return file.read()
                    
        finally:
            # Clean up temporary file
            os.unlink(temp_path)
            
    except Exception as e:
        logger.error(f"Error downloading/reading S3 file {bucket}/{key}: {str(e)}")
        raise


def parse_json_from_text(text: str) -> dict:
    """Extract and parse JSON from agent output (handles ```json code blocks)."""
    if "```json" in text:
        json_text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        json_text = text.split("```")[1].split("```")[0].strip()
    else:
        json_text = text.strip()
    return json.loads(json_text)


def upload_analysis_to_s3(bucket: str, s3_key: str, analysis_json: dict) -> None:
    """Upload analysis JSON to S3."""
    body = json.dumps(analysis_json, ensure_ascii=False, indent=2)
    s3_client.put_object(
        Bucket=bucket,
        Key=s3_key,
        Body=body,
        ContentType="application/json",
    )
    logger.info(f"💾 Saved analysis to s3://{bucket}/{s3_key}")


def extract_name_from_key(s3_key: str) -> str:
    """Extract candidate name from S3 key"""
    try:
        filename = Path(s3_key).stem
        name = filename.replace('_', ' ').replace('-', ' ')
        return ' '.join(word.capitalize() for word in name.split())
    except:
        return "Unknown Candidate"

if __name__ == "__main__":
    # async def test():
    #     # First call with document payload to create session
    #     document_payload = {
    #         "bucket": "amzn-s3-resume-analyzer-v2-bucket-agentcore-206409480438",
    #         #"resume_key": "resumes/20251125_124020_john_smith_resume.txt",
    #         "job_description_key": "opportunities/SAMPLE_SO_1234/jd/sample_job_description_senior_java_cloud_engineer.pdf"
    #     }
        
    #     print("=== First call: Processing documents ===")
    #     response1 = ""
    #     async for chunk in invoke(document_payload):
    #         response1 += str(chunk)
    #     print(f"Document processing result: {response1[:200]}...")
    
    # asyncio.run(test())
    async def test():
        # First call with document payload to create session
        document_payload = {
            "bucket": "amzn-s3-resume-analyzer-v2-bucket-agentcore-206409480438",
            "resume_key": "opportunities/SO_000005/candidates/sample_resume_arjun_mehta.pdf",
            "job_analysis_key": "opportunities/SO_000005/jd/jd.json"
        }
        
        print("=== First call: Processing documents ===")
        response1 = ""
        async for chunk in invoke(document_payload):
            response1 += str(chunk)
        print(f"Document processing result: {response1[:200]}...")
    
    asyncio.run(test())
    # app.run()


