FROM python:3.12-slim

WORKDIR /code

COPY ./requirements.txt /code/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /code/requirements.txt

# Offline IP -> city/country and network lookups for the visit log.
# DB-IP Lite databases, CC BY 4.0 (https://db-ip.com). Uses this month's release, or last month's.
COPY fetch_geo.py /code/
RUN python /code/fetch_geo.py /code/geo

COPY app.py visits.py inbox.py knowledge.md /code/

# Hugging Face Spaces run containers as uid 1000
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    GEO_DIR=/code/geo

EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
