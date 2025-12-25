# CHANGE: Use Python 3.10 instead of 3.9
FROM python:3.10

WORKDIR /code

# Copy requirements first
COPY ./requirements.txt /code/requirements.txt

# CHANGE: Upgrade pip first, then install dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --upgrade -r /code/requirements.txt

# Copy the rest of the app
COPY . .

# Create non-root user (Standard for Hugging Face)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

EXPOSE 7860

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]