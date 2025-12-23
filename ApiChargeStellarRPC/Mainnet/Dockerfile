# ApiCharge Stellar RPC - Mainnet
#
# Build from repository root:
#   docker build -t apicharge/apicharge-stellar-rpc:mainnet \
#     -f WrappedInfrastructure/StellarServers/ApiChargeStellarRPC/Release-Mainnet/Dockerfile .
#
# Or pull pre-built from Docker Hub:
#   docker pull apicharge/apicharge-stellar-rpc:mainnet

# Build stage for ApiCharge
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build-api
WORKDIR /src

# Copy NuGet.config and LocalPackages folder first (needed for restore)
COPY ["NuGet.config", "NuGet.config"]
COPY ["LocalPackages/", "LocalPackages/"]

# Copy project file and restore dependencies
COPY ["ApiChargePrototype/ApiChargePrototype.csproj", "ApiChargePrototype.csproj"]
RUN dotnet restore "ApiChargePrototype.csproj"

# Copy source code and build
COPY ApiChargePrototype /src
RUN dotnet build "ApiChargePrototype.csproj" -c Release -o /app/build

# Publish stage for ApiCharge
FROM build-api AS publish-api
RUN dotnet publish "ApiChargePrototype.csproj" -c Release -o /app/publish \
    /p:UseAppHost=true \
    /p:SelfContained=true \
    /p:PublishTrimmed=true \
    /p:PublishSingleFile=true \
    /p:RuntimeIdentifier=linux-x64

# Final stage - based on Stellar RPC
FROM stellar/stellar-rpc:24.0.0

# Install necessary utilities, ICU libraries, Redis, and dropbear SSH server
RUN apt-get update && \
    apt-get install -y \
        dos2unix \
        curl \
        findutils \
        libicu-dev \
        redis-server \
        dropbear \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for running services
RUN adduser --disabled-password --gecos "" sorobanuser && \
    mkdir -p /var/lib/stellar /config /app /certs /data/redis && \
    chown -R sorobanuser:sorobanuser /var/lib/stellar /config /app /certs /data/redis

# Copy Redis configuration
COPY WrappedInfrastructure/StellarServers/ApiChargeStellarRPC/Release-Mainnet/redis.conf /etc/redis/redis.conf
RUN chmod 644 /etc/redis/redis.conf && \
    chown sorobanuser:sorobanuser /etc/redis/redis.conf && \
    chmod 755 /etc/redis && \
    chown -R sorobanuser:sorobanuser /etc/redis

# Copy ApiCharge application
WORKDIR /app
COPY --from=publish-api /app/publish .
COPY WrappedInfrastructure/StellarServers/ApiChargeStellarRPC/Release-Mainnet/appsettings.json /app/appsettings.json

# Create config directory with default welcome.html
RUN mkdir -p /app/config
COPY WrappedInfrastructure/StellarServers/ApiChargeStellarRPC/Release-Mainnet/welcome.html /app/config/welcome.html
RUN chown -R sorobanuser:sorobanuser /app

# Create Soroban RPC config directory and add config
WORKDIR /config
COPY WrappedInfrastructure/StellarServers/ApiChargeStellarRPC/Release-Mainnet/stellar-core.cfg /config/stellar-core.cfg
COPY WrappedInfrastructure/StellarServers/ApiChargeStellarRPC/Release-Mainnet/soroban-rpc.toml /config/soroban-rpc.toml
RUN chown -R sorobanuser:sorobanuser /config

# Create startup script
WORKDIR /
COPY WrappedInfrastructure/StellarServers/ApiChargeStellarRPC/Release-Mainnet/startup.sh /startup.sh
RUN dos2unix /startup.sh && \
    chmod +x /startup.sh && \
    chown sorobanuser:sorobanuser /startup.sh

# Expose ports
EXPOSE 80
EXPOSE 443

# Environment defaults
ENV ASPNETCORE_ENVIRONMENT=Production
ENV APICHARGE_NETWORK_TYPE=Mainnet
ENV APICHARGE_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"

# Persistent volumes
VOLUME ["/var/lib/stellar", "/data/redis", "/certs", "/app/config"]

# Switch to non-root user
USER sorobanuser

ENTRYPOINT ["/startup.sh"]
